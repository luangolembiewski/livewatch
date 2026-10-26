// Carrega o .env da pasta do Livewatch (não do terminal), antes de qualquer outro módulo ler process.env.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });
