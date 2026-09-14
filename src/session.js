import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function sessionPath(){const root=process.env.XDG_CONFIG_HOME||join(homedir(),".config");return join(root,"cpx","recovery-session.json");}

export function snapshotSession(tabs,activeTabIndex){
  return {version:1,savedAt:new Date().toISOString(),activeTabIndex,tabs:tabs.map(tab=>({
    filePath:tab.filePath,displayName:tab.displayName||null,text:tab.buffer.text,savedText:tab.buffer.savedText,
    cursor:tab.buffer.cursor,selectionAnchor:tab.buffer.selectionAnchor,viewport:tab.viewport||{topLine:0,leftColumn:0},
    mtimeMs:tab.mtimeMs
  }))};
}

export async function loadRecoverySession(){
  try{const value=JSON.parse(await readFile(sessionPath(),"utf8"));return value?.version===1&&Array.isArray(value.tabs)&&value.tabs.length?value:null;}catch{return null;}
}

export async function saveRecoverySession(session){
  const path=sessionPath(),temporary=`${path}.tmp`;await mkdir(dirname(path),{recursive:true});
  await writeFile(temporary,`${JSON.stringify(session)}\n`,{mode:0o600});await rename(temporary,path);
}

export async function clearRecoverySession(){try{await unlink(sessionPath());}catch(error){if(error.code!=="ENOENT")throw error;}}
