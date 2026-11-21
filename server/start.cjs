'use strict';const path=require('path'),fs=require('fs');
const env=path.join(__dirname,'.env');
if(fs.existsSync(env)){if(typeof process.loadEnvFile!=='function'){console.error('请使用 Node.js 20.19 或更高版本。');process.exit(1);}try{process.loadEnvFile(env);}catch{console.error('server/.env无法读取，请检查文件格式与权限。');process.exit(1);}}
const {createServer}=require('./server');const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8787);
if(!Number.isInteger(port)||port<1||port>65535){console.error('PORT必须为1到65535之间的整数。');process.exit(1);}
const server=createServer();server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口 '+port+' 已被占用：请关闭旧服务，或修改server/.env中的PORT后重启。':e.code==='EACCES'?'没有监听该端口的权限，请更换端口。':'服务未能启动，请检查HOST和PORT。');process.exitCode=1;});
server.listen(port,host,()=>{console.log('健康管家 DeepSeek 后端：http://'+host+':'+port);console.log('模型：'+(process.env.DEEPSEEK_MODEL||'deepseek-flash'));console.log(process.env.DEEPSEEK_API_KEY?'已读取密钥；是否真正连通请运行“测试DeepSeek连接.bat”。':'尚未配置密钥：先运行“配置DeepSeek.bat”。本地记录功能仍可使用。');console.log('请从上面的地址打开网页；关闭此终端会停止服务。');});
