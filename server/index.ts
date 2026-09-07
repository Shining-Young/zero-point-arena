import { createGameServer } from './gateway.ts';

const port=Number(process.env.PORT??3001);
const server=await createGameServer({port,host:'0.0.0.0'});
console.log(JSON.stringify({event:'server_started',port}));
const shutdown=async()=>{await server.close();process.exit(0);};
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);

