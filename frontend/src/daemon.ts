import { createServer } from 'node:http';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Store, socketPath, dataDir } from './store.ts';
import { Core } from './core.ts';
import { html, css, js } from './dashboard.ts';
import { onboardingCss } from './onboarding.ts';

export async function startDaemon(dir?:string,port=Number(process.env.RN_PORT||4319)) {
  dir=dir||dataDir();mkdirSync(dir,{recursive:true,mode:0o700});const lock=join(dir,'daemon.lock');
  if(existsSync(lock)) {
    const pid=Number(readFileSync(lock,'utf8')); let alive=false;
    try{process.kill(pid,0);alive=true}catch(error:any){if(error.code==='EPERM')alive=true}
    if(alive)throw new Error('Another companion owns this profile');
    unlinkSync(lock);
  }
  writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});
  const store=new Store(dir);const core=new Core(store); let webPort=port,ready=false;
  const handler=(socket:boolean)=>async(req:any,res:any)=>{
    const send=(status:number,value:any)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
    const origin=`http://127.0.0.1:${webPort}`;
    if(!socket && req.headers.host!==`127.0.0.1:${webPort}`)return send(403,{error:'Invalid Host'});
    if(req.headers.origin && req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
    if(!socket && req.method==='GET' && ['/','/network','/repos','/inbox','/settings','/app.js','/style.css'].includes(req.url)) {
      res.writeHead(200,{'Content-Type':req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
      return res.end(req.url==='/app.js'?js:req.url==='/style.css'?css+onboardingCss:html);
    }
    const supplied=Buffer.from(req.headers.authorization||'');const expected=Buffer.from(`Bearer ${store.state.session_token}`);
    if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return send(401,{error:'Open the dashboard URL printed by rn dashboard'});
    if(!ready)return send(503,{error:'Companion is still starting'});
    if(req.method!=='POST'||req.url!=='/rpc')return send(404,{error:'Not found'});
    if(!String(req.headers['content-type']).startsWith('application/json'))return send(415,{error:'JSON required'});
    try {
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>32768){send(413,{error:'Request too large'});return}}
      const {method,args}=JSON.parse(body);
      if(method==='shutdown'){core.stopping=true;send(200,{result:{stopping:true}});setImmediate(()=>void stop());return}
      if(core.stopping)return send(503,{error:'Companion is stopping'});
      const result=await core.dispatch(method,args);send(200,{result});
    }catch(error){send(400,{error:error instanceof Error?error.message:String(error)})}
  };
  const ipc=createServer(handler(true));const web=createServer(handler(false));
  const socket=socketPath(store.dir);if(process.platform!=='win32'&&existsSync(socket))unlinkSync(socket);
  const listen=(server:any,address:any)=>new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(address,resolve)});
  try{await listen(ipc,socket);if(process.platform!=='win32')chmodSync(socket,0o600);await listen(web,{host:'127.0.0.1',port});}
  catch(error){ipc.close();web.close();unlinkSync(lock);throw error}
  webPort=(web.address() as any).port;
  const url=`http://127.0.0.1:${webPort}/#token=${store.state.session_token}`;
  writeFileSync(join(store.dir,'dashboard.json'),JSON.stringify({url,pid:process.pid}),{mode:0o600});
  ready=true;
  const interval=setInterval(()=>void core.sync(),3000);void core.sync();
  let stopping:Promise<void>|undefined;
  function stop(){return stopping||= (async()=>{core.stopping=true;clearInterval(interval);core.worker.stop();await Promise.all([new Promise<void>(r=>ipc.close(()=>r())),new Promise<void>(r=>web.close(()=>r()))]);while(core.syncing||core.worker.active.size)await new Promise(r=>setTimeout(r,50));if(existsSync(lock))unlinkSync(lock);})();}
  return {core,url,port:webPort,stop};
}
