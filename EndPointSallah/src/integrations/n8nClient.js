// src/integrations/n8nClient.js
import axios from "axios";

const { N8N_WEBHOOK_URL, N8N_API_KEY } = process.env;

function headers() {
  const h = { "Content-Type": "application/json" };
  if (N8N_API_KEY) h["x-api-key"] = N8N_API_KEY; // ou ce que tu veux vérifier côté n8n
  return h;
}

/**
 * Demande à n8n la liste des tâches.
 * payload minimal recommandé côté n8n: { tasks_by_day: { LUNDI:[{id,title}], ... } }
 */
export async function n8nGetTasks(params) {
  if (!N8N_WEBHOOK_URL) return null;
  const { flow_token, screen, day, initial_data } = params;
  const res = await axios.post(
    N8N_WEBHOOK_URL,
    { event: "GET_TASKS", flow_token, screen, day, initial_data },
    { headers: headers(), timeout: 10000 }
  );
  return res.data || null;
}

/**
 * Envoie à n8n les tâches complétées pour enregistrement.
 */
export async function n8nSubmitResult(params) {
  if (!N8N_WEBHOOK_URL) return null;
  const { flow_token, day, completed_tasks, raw } = params;
  const res = await axios.post(
    N8N_WEBHOOK_URL,
    { event: "SUBMIT", flow_token, day, completed_tasks, raw },
    { headers: headers(), timeout: 10000 }
  );
  return res.data || null;
}

