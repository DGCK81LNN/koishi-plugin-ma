import { Context, Schema, h } from "koishi"

export const name = "ma:aux_commands"

type Toggle<T> = T & { enabled: boolean }

function schemaToggle<T>(schema: Schema<T>, remark: string): Schema<Toggle<T>> {
  return Schema.intersect([
    Schema.object({
      enabled: Schema.boolean().description("启用" + remark),
    }).description(""),
    Schema.union([
      Schema.object({
        enabled: Schema.const(true).required(true),
        ...schema.dict,
      }),
      Schema.object({
        enabled: Schema.const(false),
      }),
    ]),
  ]) as Schema<Toggle<T>>
}

interface CatConfig {
  fetchMaxLength: number
  fetchMaxInterpolationLength: number
}

export interface Config {
  echo: Toggle<{}>
  cat: Toggle<CatConfig>
  send: Toggle<{}>
}

export const Config: Schema<Config> = Schema.object({
  echo: schemaToggle(
    Schema.object({}),
    "改良版 echo 指令：不会自动将消息元素转换成 XML 形式，并增加更多转义功能。\n\n" +
      "若要使用，必须停用官方 echo 插件。"
  ),
  cat: schemaToggle<CatConfig>(
    Schema.object({
      fetchMaxLength: Schema.number()
        .description("cat 指令抓取 URL 内容的最大长度。")
        .default(4000),
      fetchMaxInterpolationLength: Schema.number()
        .description("cat 指令在“$()”插值语法中运行时，抓取 URL 内容的最大长度。")
        .default(50000),
    }),
    " cat 指令：重复下一条消息，或从 URL 获取文本；同时可进行转义。"
  ),
  send: schemaToggle(
    Schema.object({}),
    " send 指令：发送消息到指定上下文。\n\n" +
      "补足了官方 echo 具有但上述改良 echo 没有的功能。"
  ),
})

function transform(
  message: string,
  { escape = false, unescape = false, markov = false, ord = false, hexOrd = false }
) {
  if (escape) return h.escape(message)
  if (unescape) return h.unescape(message)
  if (markov)
    return h.transform(message, {
      text: ({ content: c }) =>
        String(c)
          .replace(/[\\;=,%]/g, s => "\\" + s)
          .replace(/\n/g, "\\n")
          .replace(/\r/g, "\\r")
          .replace(/\t/g, "\\t"),
    })
  if (ord)
    return h.transform(message, {
      text: ({ content: c }) => [...c].map(c => `&#${c.codePointAt(0)};`).join(""),
    })
  if (hexOrd)
    return h.transform(message, {
      text: ({ content: c }) =>
        [...c].map(c => `&#x${c.codePointAt(0).toString(16)};`).join(""),
    })
  return message
}

function parsePlatform(target: string): [platform: string, id: string] {
  const index = target.lastIndexOf(":")
  const platform = target.slice(0, index)
  const id = target.slice(index + 1)
  console.dir([platform, id])
  return [platform, id]
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)

  if (config.echo.enabled) {
    ctx
      .command("echo <message:el>", {
        checkUnknown: true,
        showWarning: true,
      })
      .option("escape", "-e")
      .option("unescape", "-E", { authority: 3 })
      .option("markov", "-M")
      .option("ord", "-o")
      .option("hexOrd", "-x")
      .action(async ({ session, options }, els) => {
        if (!els?.length) {
          await session.send(session.text(".expect-content"))
          return
        }
        const { escape, unescape, markov, ord, hexOrd } = options
        if (+!!escape + +!!unescape + +!!markov + +!!ord + +!!hexOrd > 1) {
          await session.send(session.text(".conflicting-options"))
          return
        }
        let message = els.join("")
        return transform(message, options)
      })
  }

  if (config.cat.enabled) {
    ctx
      .command("cat [url:rawtext]", {
        checkUnknown: true,
        showWarning: true,
      })
      .option("escape", "-e")
      .option("unescape", "-E", { authority: 3 })
      .option("markov", "-M")
      .option("ord", "-o")
      .option("hexOrd", "-x")
      .action(async ({ session, options, initiator }, url) => {
        const { escape, unescape, markov, ord, hexOrd } = options
        if (+!!escape + +!!unescape + +!!markov + +!!ord + +(+!!hexOrd) > 1) {
          await session.send(session.text(".conflicting-options"))
          return
        }
        let message = ""
        if (url) {
          try {
            message = h.escape(await ctx.http.get(url, { responseType: "text" }))
          } catch (err) {
            await session.send(err?.message || String(err))
            logger.info(err)
            return
          }
          if (
            message.length >
            (initiator === "$("
              ? config.cat.fetchMaxInterpolationLength
              : config.cat.fetchMaxLength)
          ) {
            await session.send(session.text(".fetch-content-too-long"))
            return
          }
        } else {
          await session.send(session.text(".awaiting-input"))
          message = await session.prompt()
        }
        if (!message) {
          await session.send(session.text(".no-text"))
          return
        }
        return transform(message, options)
      })
  }

  if (config.send.enabled) {
    ctx
      .command("send <message:el>", {
        checkUnknown: true,
        showWarning: true,
        authority: 3,
      })
      .option("user", "-u <user:user>")
      .option("channel", "-c <channel:channel>")
      .option("guild", "-g <guild:string>")
      .action(async ({ session, options }, content) => {
        if (!content?.length) return session.send(session.text(".expect-content"))

        // https://github.com/koishijs/koishi/blob/e83e6bd1aabb85e8e415d5eefc0f959d4a4d82fb/plugins/common/echo/src/index.ts#L36-L48
        const target = options.user || options.channel
        if (target) {
          const [platform, id] = parsePlatform(target)
          const bot = ctx.bots.find(bot => bot.platform === platform)
          if (!bot) {
            return session.text(".platform-not-found")
          } else if (options.user) {
            await bot.sendPrivateMessage(id, content, session.guildId)
          } else {
            await bot.sendMessage(id, content, options.guild)
          }
          return
        }

        return session.text(".expect-context")
      })
  }
}
