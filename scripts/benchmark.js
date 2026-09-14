import { performance } from "node:perf_hooks";
import { TextBuffer } from "../src/buffer.js";
import { Renderer } from "../src/renderer.js";

const text=Array.from({length:100_000},(_,index)=>`line ${index+1} const value_${index} = "benchmark"; payload `).join("\n");
const buffer=new TextBuffer(text);buffer.lines();
const time=action=>{const start=performance.now();action();return performance.now()-start;};
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const gotoMs=time(()=>buffer.goToLine(99_999));
const verticalMs=time(()=>buffer.moveVertical(-1));
const searchMs=time(()=>buffer.text.indexOf("value_98765"));
buffer.cursor=Math.floor(buffer.text.length/2);
const insertMs=time(()=>buffer.insert("X"));
const output={columns:120,rows:40,write(value){this.lastLength=value.length;}};
const renderer=new Renderer(output);
const settings={colorScheme:0,suggestions:false};
const tab={filePath:"benchmark.js",buffer,aiQueue:[]};
const draw=()=>renderer.draw({buffer,filePath:"benchmark.js",status:"",prompt:null,busy:"",runPanel:null,tabs:[tab],activeTabIndex:0,settingsPanel:null,helpPanel:null,fileBrowser:null,settings,suggestions:[],suggestion:null,suggestionChoice:0,tooltip:null,diagnostics:[]});
const coldRedrawMs=time(draw),redrawMs=median(Array.from({length:20},()=>time(draw)));

console.log(JSON.stringify({lines:100_000,bytes:Buffer.byteLength(text),gotoMs,verticalMs,searchMs,insertMs,coldRedrawMs,steadyRedrawMedianMs:redrawMs,rssMiB:process.memoryUsage().rss/1024/1024},null,2));
