import { Context, Schema, h } from "koishi"

export const name = "ma:aux_commands"

export interface Config {
  echo: {
    enabled: boolean
  }
  cat: {
    enabled: boolean
    fetchMaxLength: number
    fetchMaxInterpolationLength: number
  }
}

export const Config: Schema<Config> = Schema.object({
  echo: Schema.object({
    enabled: Schema.boolean().description("启用").default(false),
  })
    .collapse()
    .description("改良的 echo 指令。"),
  cat: Schema.object({
    enabled: Schema.boolean().description("启用").default(false),
    fetchMaxLength: Schema.number()
      .description("抓取 URL 内容的最大长度。")
      .default(4000),
    fetchMaxInterpolationLength: Schema.number()
      .description("在“$()”插值语法中运行时，抓取 URL 内容的最大长度。")
      .default(50000),
  })
    .collapse()
    .description("cat 指令。"),
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
        h.text(
          String(c)
            .replace(/[\\;=,%]/g, s => "\\" + s)
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t")
        ),
    })
  if (ord) return [...message].map(c => `&amp;#${c.codePointAt(0)};`).join("")
  if (hexOrd)
    return [...message].map(c => `&amp;#x${c.codePointAt(0).toString(16)};`).join("")
  return message
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)

  if (config.echo) {
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
        const { escape, unescape, markov, ord, hexOrd } = options
        if (+!!escape + +!!unescape + +!!markov + +!!ord + +!!hexOrd > 1) {
          await session.send(session.text(".conflicting-options"))
          return
        }
        let message = els.join("")
        return transform(message, options)
      })
  }

  if (config.cat) {
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
}
