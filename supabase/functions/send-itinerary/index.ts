// Punto de entrada de la Edge Function send-itinerary. La lógica vive en handler.ts para poder probarla completa
// (con dependencias falsas) sin levantar un servidor. Requiere JWT (verify_jwt por defecto), igual que send-proposal.
import { handleRequest } from './handler.ts';

Deno.serve((req) => handleRequest(req));
