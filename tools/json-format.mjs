// Pretty-prints JSON like JSON.stringify(value, null, 2), but keeps short arrays and objects
// that only hold plain values on one line (objects only as property values, not array items), matching the hand-written style of data/projects.json.

const MAX_INLINE = 120;

function isFlat(value) {
  const items = Array.isArray(value) ? value : Object.values(value);
  return items.every((v) => v === null || typeof v !== 'object');
}

function format(value, indent, inArray = false) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const isArray = Array.isArray(value);
  const entries = isArray ? value : Object.entries(value);
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) return open + close;

  const render = (e, ind) => (isArray ? format(e, ind, true) : `${JSON.stringify(e[0])}: ${format(e[1], ind)}`);

  if (isFlat(value) && (isArray || !inArray)) {
    const inner = entries.map((e) => render(e, indent)).join(', ');
    const line = isArray ? `[${inner}]` : `{ ${inner} }`;
    if (indent.length + line.length <= MAX_INLINE) return line;
  }

  const next = indent + '  ';
  return `${open}\n${entries.map((e) => next + render(e, next)).join(',\n')}\n${indent}${close}`;
}

export function formatJson(value) {
  return format(value, '') + '\n';
}
