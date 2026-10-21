// Punto de entrada de la Edge Function send-proposal. La lógica vive en handler.ts para poder probarla completa (con
// dependencias falsas) sin levantar un servidor.
import { handleRequest } from './handler.ts';

Deno.serve((req) => handleRequest(req));
