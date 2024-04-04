import type {} from "@koishijs/plugin-help"
import { Context, Schema, Session, h } from "koishi"
import assert from "node:assert"
import run from "./interpreter"

export const name = "ma"
export const inject = ["component:html"]

export interface Config {
  maxRules: number
  maxMetaRules: number
  maxIterations: number
  headIterations: number
  tailIterations: number
  maxStringSize: number
  maxResultStringSize: number
  maxInterpolatedResultStringSize: number
  maxRenderStringSize: number
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
  maxIterations: Schema.number().default(100000).description("迭代的最大步数。"),
  headIterations: Schema.number()
    .default(50)
    .description("迭代数量较多时，至少显示开头的迭代数量。"),
  tailIterations: Schema.number()
    .default(50)
    .description("迭代数量较多时，至少显示末尾的迭代数量。"),
  maxStringSize: Schema.number()
    .default(100000)
    .description("字符串的最大 UTF-16 编码单元数。"),
  maxResultStringSize: Schema.number()
    .default(1000)
    .description("结果字符串的最大 UTF-16 编码单元数。"),
  maxInterpolatedResultStringSize: Schema.number()
    .default(50000)
    .description("在“$()”插值语法中运行本指令时，结果字符串的最大 UTF-16 编码单元数。"),
  maxRenderStringSize: Schema.number()
    .default(100000)
    .description("图片中渲染字符串的最大总 UTF-16 编码单元数。"),
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
      <code>{iteration}</code>
    </li>
  ))
}

export function apply(ctx: Context, config: Config) {
  ctx.i18n.define("zh", require("./locales/zh"))

  //const logger = ctx.logger("ma")

  async function process(
    session: Session,
    program: string,
    { image = true } = {}
  ): Promise<{ error?: unknown; result?: string }> {
    const iterable = run(program || "", {
      maxRules: config.maxRules,
      maxMetaRules: config.maxMetaRules,
      maxIterations: config.maxIterations,
      maxStringSize: config.maxStringSize,
    })
    let result: string

    if (!image)
      try {
        iterable.next()
        for (const iteration of iterable) result = iteration
        return { result }
      } catch (error: unknown) {
        return { error, result }
      }

    const headIterations: string[] = []
    const tailIterations: string[] = []
    let error: unknown = null
    let stage = 0
    let iterationsSkipped = 0
    let size = 0

    try {
      const first = iterable.next()
      assert(first.done !== true)
      headIterations.push(first.value)
      size += first.value.length

      for (const iteration of iterable) {
        result = iteration
        size += iteration.length

        if (stage === 0) {
          headIterations.push(iteration)
          if (
            size > config.maxRenderStringSize ||
            headIterations.length >= config.headIterations
          )
            stage = 1
        } else {
          tailIterations.push(iteration)
          while (
            tailIterations.length > 1 &&
            (size > config.maxRenderStringSize ||
              tailIterations.length >= config.tailIterations)
          ) {
            size -= tailIterations.shift().length
            iterationsSkipped++
          }
        }
      }
    } catch (err: unknown) {
      error = err
    }

    if (result != null) {
      const dom: (string | h)[] = []
      if (iterationsSkipped === 0)
        dom.push(<ol>{renderIterations(headIterations.concat(tailIterations))}</ol>)
      else
        dom.push(
          <ol>{renderIterations(headIterations)}</ol>,
          <div>{session.text(".iterations-ellipsized", [iterationsSkipped])}</div>,
          <ol start={headIterations.length + iterationsSkipped + 1}>
            {renderIterations(tailIterations)}
          </ol>
        )

      const totalIterations =
        headIterations.length + iterationsSkipped + tailIterations.length

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
              padding-left: ${Math.floor(Math.log10(totalIterations)) + 3}ch;
            }`
          }</style>
          {dom}
        </html>
      )
    }

    return { error, result }
  }

  const cmd = ctx
    .command("ma <program:rawtext>", {
      checkUnknown: true,
      showWarning: true,
    })
    .option("image", "", { fallback: true })
    .option("image", "-M", { value: false, hidden: true })
  cmd.action(async ({ options, session, initiator }, text) => {
    const interpolated = initiator === "$("

    //logger.debug(require("node:util").inspect(dom.toString(), !1, 5, !0))
    const { error, result } = await process(session, text, options)

    if (error != null) {
      await session.send(String(error))
      return interpolated ? "\n" : ""
    }
    if (result == null) {
      await session.send(session.text(".no-operation"))
      return interpolated ? "\n" : ""
    }
    if (!result.trim()) {
      await session.send(session.text(".empty-result"))
      return interpolated ? "\n" : ""
    }
    const maxResultSize = interpolated
      ? config.maxInterpolatedResultStringSize
      : config.maxResultStringSize
    if (result.length > maxResultSize) {
      await session.send(session.text(".result-too-long"))
      return interpolated ? "\n" : ""
    }
    return h.escape(result)
  })
}
