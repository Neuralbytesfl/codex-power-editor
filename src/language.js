import { extname } from "node:path";

const python = {
  def: "def name(parameters): — define a function",
  class: "class Name: — define a class",
  if: "if condition: — run a block when a condition is true",
  elif: "elif condition: — test another condition",
  else: "else: — fallback branch",
  for: "for item in iterable: — iterate over values",
  while: "while condition: — repeat while a condition is true",
  return: "return value — leave a function and optionally produce a value",
  import: "import module — load a Python module",
  from: "from module import name — import selected names",
  try: "try: — begin exception-protected code",
  except: "except Error: — handle an exception",
  with: "with resource as name: — manage a context safely",
  lambda: "lambda args: expression — create a small anonymous function",
  yield: "yield value — produce a generator value",
  async: "async def — define asynchronous code",
  await: "await expression — wait for an async operation",
  print: "print(*objects, sep=' ', end='\\n') — write values to standard output",
  len: "len(object) — return the number of items",
  range: "range(start, stop, step) — produce a sequence of integers",
  enumerate: "enumerate(iterable, start=0) — yield index/value pairs",
  zip: "zip(*iterables) — combine iterables item by item",
  open: "open(file, mode='r') — open a file and return a stream",
  list: "list(iterable) — create a mutable sequence",
  dict: "dict(...) — create a key/value mapping",
  set: "set(iterable) — create a collection of unique values",
  str: "str(object) — create a text representation",
  int: "int(value) — create an integer",
  float: "float(value) — create a floating-point number",
  bool: "bool(value) — convert a value to True or False",
  None: "None — Python's absence-of-value singleton",
  True: "True — boolean true value",
  False: "False — boolean false value"
};

const cFamily = {
  if: "if (condition) — conditionally execute a statement",
  else: "else — fallback branch of an if statement",
  for: "for (init; condition; step) — counted loop",
  while: "while (condition) — conditional loop",
  return: "return value; — leave a function",
  struct: "struct Name { ... }; — define a record type",
  class: "class Name { ... }; — define a C++ class",
  const: "const — prevent modification through this declaration",
  constexpr: "constexpr — request compile-time evaluation",
  auto: "auto name = value; — infer a C++ type",
  template: "template <...> — define generic C++ code",
  namespace: "namespace name { ... } — group C++ declarations",
  printf: "printf(format, ...) — print formatted C output",
  malloc: "malloc(bytes) — allocate uninitialized memory",
  free: "free(pointer) — release malloc-allocated memory",
  vector: "std::vector<T> — dynamically sized C++ array",
  string: "std::string — owning C++ text value",
  cout: "std::cout << value — write to standard output",
  cin: "std::cin >> value — read from standard input",
  size_t: "size_t — unsigned type used for sizes and indexes"
};

export const generalWords = {
  main:"main — conventional program entry point", value:"value — a stored or passed value",
  result:"result — a computed outcome", data:"data — information being processed",
  error:"error — failure information", config:"config — program configuration",
  options:"options — optional behavior settings", input:"input — data entering a program",
  output:"output — data produced by a program", index:"index — a position in a collection",
  length:"length — number of elements or characters", name:"name — identifier or label",
  path:"path — filesystem location", file:"file — stored data resource",
  read:"read — obtain data from a source", write:"write — send data to a destination",
  parse:"parse — convert text into structured data", format:"format — shape data for display",
  map:"map — transform collection elements", filter:"filter — retain matching elements",
  reduce:"reduce — combine elements into one result", sort:"sort — arrange elements",
  find:"find — locate a matching element", includes:"includes — test collection membership",
  slice:"slice — extract part of a sequence", join:"join — combine parts with a separator",
  split:"split — divide text into parts", replace:"replace — substitute matching content"
};

export function languageWords(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (!extension) return { ...cFamily, ...python };
  if (extension === ".py") return python;
  if ([".c", ".h", ".cc", ".cpp", ".cxx", ".hpp"].includes(extension)) return cFamily;
  return {};
}

export function definitionForWord(filePath, word, source = "") {
  const builtIn = languageWords(filePath)[word] || generalWords[word];
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (filePath.toLowerCase().endsWith(".py") || !filePath) {
    const assignment=source.match(new RegExp(`^\\s*${escaped}\\s*(?::\\s*([^=\\n]+))?=\\s*([^\\n#]+)`,"m"));
    if(assignment){
      const annotation=assignment[1]?.trim(),value=assignment[2].trim();
      let type=annotation;
      if(!type){
        if(/^([rubf]*)(["']).*\2$/i.test(value))type="str";
        else if(/^[+-]?\d+$/.test(value))type="int";
        else if(/^[+-]?(?:\d+\.\d*|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value))type="float";
        else if(/^(True|False)$/.test(value))type="bool";
        else if(value==="None")type="NoneType";
        else if(/^\[/.test(value))type="list";
        else if(/^\(/.test(value))type="tuple";
        else if(/^\{\s*\}/.test(value)||/^\{[^\n]*:/.test(value))type="dict";
        else if(/^\{/.test(value))type="set";
        else type=value.match(/^(str|tuple|dict|list|set|int|float|bool)\s*\(/)?.[1];
      }
      if(type)return `${word}: ${type} — inferred from ${word} = ${value.slice(0,60)}`;
    }
  }
  if (builtIn) return builtIn;
  const patterns = [
    new RegExp(`^\\s*(async\\s+)?def\\s+${escaped}\\s*(\\([^\\n]*\\))`, "m"),
    new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*(\\([^\\n]*\\))`, "m"),
    new RegExp(`^\\s*[\\w:<>,*&\\s]+\\s+${escaped}\\s*(\\([^;\\n]*\\))\\s*\\{`, "m")
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return `${word}${match.at(-1)} — function defined in this file`;
  }
  return null;
}
