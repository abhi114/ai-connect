import readline from 'node:readline';
let initialized=false;
for await(const line of readline.createInterface({input:process.stdin})) {
  const message=JSON.parse(line);
  if(message.method==='initialized'){initialized=true;continue}
  let result={};
  if(message.method==='model/list') {
    if(!initialized)throw Error('Initialization notification missing');
    result=message.params.cursor?{data:[{model:'second',displayName:'Second',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null}
      :{data:[{model:'first',displayName:'First',supportedReasoningEfforts:[{reasoningEffort:'low'}]}, {model:'secret',hidden:true}],nextCursor:'page-two'};
  }
  console.log(JSON.stringify({id:message.id,result}));
}
