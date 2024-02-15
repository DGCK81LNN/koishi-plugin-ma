const escapes = Object.create(null)
escapes.n = "\n"

function parseKv(line: string) {
  for (let i = 0, l = line.length; i < l; i++) {
    if (line[i] === "\\") {
      i++
      continue
    }
    if (line[i] === "=") {
      return [line.slice(0, i), line.slice(i + 1)]
    }
  }
}

function escapeRe(s: string) {
  return s.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d")
}

function unescape(s: string) {
  return s.replace(/\\([\s\S]|$)/g, (_, char) => {
    if (!char) throw new SyntaxError("Unexpected backslash immediately before EOF")
    return escapes[char] ?? char.trim()
  })
}

function list(s: string, sep = ",") {
  const a: string[] = []
  let splitIndex = 0
  for (let i = 0, l = s.length; i < l; i++) {
    if (s[i] === "\\") {
      i++
      continue
    }
    if (s[i] === sep) {
      a.push(s.slice(splitIndex, i))
      splitIndex = i + 1
    }
  }
  a.push(s.slice(splitIndex))
  return a
}

export default function* run(
  source: string,
  options?: {
    maxRules?: number
    maxMetaRules?: number
    maxIterations?: number
    maxStringSize?: number
  }
) {
  const maxRules = options?.maxRules ?? 1000
  const maxMetaRules = options?.maxMetaRules ?? 100
  const maxIterations = options?.maxIterations ?? 10000
  const maxStringSize = options?.maxStringSize ?? 1000

  const lines: string[] = []
  {
    let splitIndex = 0
    for (let i = 0, l = source.length; i < l; i++) {
      if (source[i] === "\\") {
        i++
        continue
      }
      if (source[i] === ";" || source[i] === "\n") {
        lines.push(source.slice(splitIndex, i))
        splitIndex = i + 1
      }
    }
    lines.push(source.slice(splitIndex))
  }

  let rawRules: [k: string, v: string, kw: string][] = []
  const metaRules: [k: string, v: string][] = []
  let str: string
  for (const line of lines) {
    if (line.startsWith("str ")) {
      if (typeof str === "string") throw new SyntaxError("Multiple str statements found")
      str = unescape(line.slice(4))
      continue
    }
    const kv = parseKv(line)
    if (!kv) continue
    let [k, v] = kv
    let kw = ""
    if (k.match(/^[a-z]{3}[ ]/)) {
      kw = k.slice(0, 3)
      k = k.slice(4)
      switch (kw) {
        case "rep":
        case "for":
          if (metaRules.length >= maxMetaRules)
            throw new RangeError("Too many meta rules")
          metaRules.push([k, v])
          continue
        case "fin":
        case "chr":
        case "ord":
          break
        default:
          throw new SyntaxError(
            `Undefined keyword ${kw}, escape with backslash for literal string`
          )
      }
    }
    if (rawRules.length >= maxRules) throw new RangeError("Too many rules")
    rawRules.push([k, v, kw])
  }
  str ??= ""
  if (str.length > maxStringSize) throw new RangeError("String too long")

  for (const [k, v] of metaRules) {
    const rk = unescape(k)
    const rv = list(v)
    rawRules = rawRules.flatMap(([k, v, kw]) => {
      if (!k.includes(rk)) return [[k, v.replaceAll(rk, rv[0]), kw]]
      if (rv.length > 1 && rawRules.length >= maxRules)
        throw new RangeError(`Too many rules created by meta rule ${k}=${v}`)
      return rv.map(
        rv => [k.replaceAll(rk, rv), v.replaceAll(rk, rv), kw] as [string, string, string]
      )
    })
  }

  const rules: [re: RegExp, replace: (...g: string[]) => string, fin: boolean][] =
    rawRules.map(([k, v, kw]) => {
      let ka = list(k, "%").map(unescape)
      let va = list(v, "%").map(unescape)
      return [
        new RegExp(ka.map(escapeRe).join(kw === "chr" ? "([1-9]\\d*)" : "(.)"), "su"),
        (_: string, ...groups: string[]) =>
          va.reduce((a, c, i) => {
            let group = groups[Math.min(ka.length - 1, i) - 1] ?? "%"
            if (kw === "chr") group = String.fromCodePoint(parseInt(group))
            else if (kw === "ord") group = String(group.codePointAt(0))
            return a + group + c
          }),
        kw === "fin",
      ]
    })

  yield str
  outer: for (let i = 0; i < maxIterations; i++) {
    for (const [re, rp, fin] of rules) {
      if (re.test(str)) {
        str = str.replace(re, rp)
        if (str.length > maxStringSize) throw new RangeError("String became too long")
        yield str
        if (fin) return
        continue outer
      }
    }
    return
  }
  throw new RangeError("Too many iterations")
}
