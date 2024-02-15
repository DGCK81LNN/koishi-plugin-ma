import { Context, Schema, h } from "koishi"
import run from "./interpreter"
import { stripTags, tryRestoreRawText } from "./utils"

export const name = "ma"
export const inject = ["component:html"]

export interface Config {
  maxRules: number
  maxMetaRules: number
  maxIterations: number
  headIterations: number
  tailIterations: number
  maxStringSize: number
  maxWidth: string
  fontFamily: string
  backColor: string
  foreColor: string
  codeBackColor: string
  codeForeColor: string
}

export const Config: Schema<Config> = Schema.object({
  maxRules: Schema.number()
    .default(1000)
    .description("规则的最大数量。主要用于限制元规则替换产生过多克隆规则。"),
  maxMetaRules: Schema.number().default(100).description("元规则的最大数量。"),
  maxIterations: Schema.number().default(10000).description("迭代的最大步数。"),
  headIterations: Schema.number()
    .default(50)
    .description("迭代数量较多时，至少显示开头的迭代数量。"),
  tailIterations: Schema.number()
    .default(50)
    .description("迭代数量较多时，至少显示末尾的迭代数量。"),
  maxStringSize: Schema.number()
    .default(10000)
    .description("字符串的最大 UTF-16 编码单元数。"),
  maxWidth: Schema.string().default("100rem").description("图片的最大宽度。"),
  fontFamily: Schema.string()
    .default("Consolas, Source Han Sans SC, Microsoft YaHei UI, monospace")
    .description("字体。"),
  backColor: Schema.string().default("#000").description("背景颜色。"),
  foreColor: Schema.string().default("#999").description("次要文字颜色。"),
  codeBackColor: Schema.string().default("#222").description("主要文字底色。"),
  codeForeColor: Schema.string().default("#eee").description("主要文字颜色。"),
})

function renderIterations(iterations: string[]) {
  return iterations.map(iteration => (
    <li>
      <code>{h.escape(iteration)}</code>
    </li>
  ))
}

export function apply(ctx: Context, config: Config) {
  ctx.i18n.define("zh", require("./locales/zh"))

  //const logger = ctx.logger("ma")

  const cmd = ctx.command("ma <program:text>", {
    checkUnknown: true,
    showWarning: true,
  })
  cmd.action(async ({ session, source }, text) => {
    if (source) text = stripTags(tryRestoreRawText(text, source) || text)
    const iterations: string[] = []
    let error: unknown = null
    try {
      for (const iteration of run(text)) iterations.push(iteration)
    } catch (err) {
      error = err
    }

    const dom: (string | h)[] = []
    //logger.level = 3
    //logger.debug(require("node:util").inspect({ iterations, config }, !1, 5, !0))
    if (iterations.length <= config.headIterations + config.tailIterations)
      dom.push(<ol>{renderIterations(iterations)}</ol>)
    else
      dom.push(
        <ol>{renderIterations(iterations.slice(0, config.headIterations))}</ol>,
        <div>
          {session.text(".iterations-ellipsized", [
            iterations.length - (config.headIterations + config.tailIterations),
          ])}
        </div>,
        <ol start={iterations.length - config.tailIterations}>
          {renderIterations(iterations.slice(-config.tailIterations))}
        </ol>
      )

    //logger.debug(require("node:util").inspect(dom.toString(), !1, 5, !0))
    if (iterations.length === 1) {
      return session.text(".no-operation")
    }

    await session.send(
      <html
        style={{
          "fontFamily": config.fontFamily,
          "maxWidth": config.maxWidth,
          "backgroundColor": config.backColor,
          "color": config.foreColor,
          "--bg": config.codeBackColor,
          "--fg": config.codeForeColor,
          "padding": "0.5em",
        }}
      >
        <style>{
          /*css*/ `
          code {
            font-family: inherit;
            background-color: var(--bg, #333);
            color: var(--fg, #eee);
            border-radius: 0.25em;
            white-space: pre-wrap;
            overflow-wrap: break-word;
            margin: 0;
          }
          ol {
            margin: 0;
            padding-left: ${Math.floor(Math.log10(iterations.length)) + 3}ch;
          }`
        }</style>
        {dom}
      </html>
    )
    if (error) {
      return String(error)
    } else {
      const result = iterations.at(-1)
      if (result === "\n") await session.send(session.text(".empty-result"))
      return result
    }
  })
}
