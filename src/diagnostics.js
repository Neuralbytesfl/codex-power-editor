export function analyzeText(text,{maxCharacters=2_000_000}={}){
  const diagnostics=[],stack=[],pairs={")":"(","]":"[","}":"{"},openers=new Set(Object.values(pairs));
  let line=0,column=0,quote=null,escaped=false,lineComment=false;
  const source=text.slice(0,maxCharacters);
  for(let index=0;index<source.length;index++){
    const char=source[index],next=source[index+1];
    if(char==="\n"){line++;column=0;lineComment=false;continue;}
    if(lineComment){column++;continue;}
    if(quote){if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char===quote)quote=null;column++;continue;}
    if(char==="#"||(char==="/"&&next==="/")){lineComment=true;column++;continue;}
    if(char==='"'||char==="'"||char==='`'){quote=char;column++;continue;}
    if(openers.has(char))stack.push({char,line,column});
    else if(pairs[char]){const opening=stack.pop();if(!opening||opening.char!==pairs[char])diagnostics.push({line,column,message:`Unmatched ${char}`});}
    if(diagnostics.length>=20)break;column++;
  }
  while(stack.length&&diagnostics.length<20){const opening=stack.pop();diagnostics.push({line:opening.line,column:opening.column,message:`Unclosed ${opening.char}`});}
  return diagnostics;
}
