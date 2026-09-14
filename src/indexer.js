import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const textExtensions = new Set([
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".js", ".jsx", ".mjs", ".cjs",
  ".ts", ".tsx", ".py", ".rb", ".rs", ".go", ".java", ".kt", ".swift", ".php",
  ".html", ".css", ".scss", ".json", ".yaml", ".yml", ".toml", ".md", ".sh", ".sql"
]);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "coverage", ".venv", "venv", "__pycache__", ".cache"]);

export function extractKnowledge(text) {
  const words = {};
  for (const word of text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) || []) words[word] = (words[word] || 0) + 1;
  const phrases = {};
  const add = value => {
    const phrase=value.trim().replace(/\s+\(/g,"(");
    if(phrase.length>=4&&phrase.length<=120)phrases[phrase]=(phrases[phrase]||0)+1;
  };
  for(const line of text.split("\n")){
    const trimmed=line.trim();
    for(const match of trimmed.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\s*\(/g))add(match[0]);
    if(/^(?:async\s+)?(?:def|class|function|import|from|const|let|var)\b/.test(trimmed))add(trimmed);
  }
  return {words,phrases};
}

export function mergeKnowledge(settings, knowledge, weight = 1) {
  settings.learnedWords ||= {};settings.learnedPhrases ||= {};
  const merge=(current,incoming,limit)=>{
    const normalized=new Map();
    for(const [value,count] of Object.entries(current)){
      const key=value.toLowerCase(),found=normalized.get(key);
      if(found)found.count=Math.min(9999,found.count+count);
      else normalized.set(key,{value,count});
    }
    for(const [value,count] of Object.entries(incoming)){
      const key=value.toLowerCase(),found=normalized.get(key);
      if(found)found.count=Math.min(9999,found.count+count*weight);
      else normalized.set(key,{value,count:Math.min(9999,count*weight)});
    }
    return Object.fromEntries([...normalized.values()].sort((a,b)=>b.count-a.count).slice(0,limit).map(item=>[item.value,item.count]));
  };
  settings.learnedWords=merge(settings.learnedWords,knowledge.words,5000);
  settings.learnedPhrases=merge(settings.learnedPhrases,knowledge.phrases,2000);
}

export async function scanKnowledgePath(target, { maxFiles=500, maxFileBytes=1_000_000, maxTotalBytes=10_000_000, onFile } = {}) {
  const root=resolve(target),result={files:0,bytes:0,skipped:0,words:{},phrases:{}};
  const mergeCounts=(destination,source)=>{for(const [key,count] of Object.entries(source))destination[key]=(destination[key]||0)+count;};
  const visit=async path=>{
    if(result.files>=maxFiles||result.bytes>=maxTotalBytes)return;
    let info;try{info=await stat(path);}catch{result.skipped++;return;}
    if(info.isDirectory()){
      let entries;try{entries=await readdir(path,{withFileTypes:true});}catch{result.skipped++;return;}
      for(const entry of entries){
        if(result.files>=maxFiles||result.bytes>=maxTotalBytes)break;
        if(entry.isSymbolicLink()||(entry.isDirectory()&&ignoredDirectories.has(entry.name)))continue;
        if(entry.name.startsWith(".")&&entry.isDirectory())continue;
        await visit(join(path,entry.name));
      }
      return;
    }
    if(!info.isFile()||info.size>maxFileBytes||(!textExtensions.has(extname(path).toLowerCase())&&path!==root)){result.skipped++;return;}
    const remaining=maxTotalBytes-result.bytes;if(info.size>remaining)return;
    try{
      const data=await readFile(path);if(data.includes(0)){result.skipped++;return;}
      const knowledge=extractKnowledge(data.toString("utf8"));mergeCounts(result.words,knowledge.words);mergeCounts(result.phrases,knowledge.phrases);
      result.files++;result.bytes+=data.length;onFile?.(path,result);
    }catch{result.skipped++;}
  };
  await visit(root);return result;
}
