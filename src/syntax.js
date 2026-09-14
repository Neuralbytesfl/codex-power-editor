import { extname } from "node:path";

const pythonKeywords=new Set("and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield".split(" "));
const cKeywords=new Set("alignas alignof auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend if inline int long namespace new nullptr private protected public register return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while".split(" "));
const jsKeywords=new Set("async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield".split(" "));

export function highlightLine(line,filePath=""){
  const kinds=new Array(line.length).fill(null),extension=extname(filePath||"").toLowerCase();
  const strings=[];const stringPattern=/(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  for(const match of line.matchAll(stringPattern)){strings.push([match.index,match.index+match[0].length]);for(let i=match.index;i<match.index+match[0].length;i++)kinds[i]="string";}
  const inString=index=>strings.some(([start,end])=>index>=start&&index<end);
  const marker=extension===".py"?"#":"//",comment=line.indexOf(marker);
  if(comment>=0&&!inString(comment))for(let i=comment;i<line.length;i++)kinds[i]="comment";
  const keywords=extension===".py"?pythonKeywords:[".js",".jsx",".mjs",".cjs",".ts",".tsx"].includes(extension)?jsKeywords:cKeywords;
  for(const match of line.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g))if(!kinds[match.index]&&keywords.has(match[0]))for(let i=match.index;i<match.index+match[0].length;i++)kinds[i]="keyword";
  for(const match of line.matchAll(/\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/gi))if(!kinds[match.index])for(let i=match.index;i<match.index+match[0].length;i++)kinds[i]="number";
  return kinds;
}
