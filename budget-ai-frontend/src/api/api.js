import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000
});

export async function createReport(payload) {
  const { data } = await api.post("/api/reports", payload);
  return data;
}

export async function fetchReports() {
  const { data } = await api.get("/api/reports");
  return data;
}

export async function fetchReport(id) {
  const { data } = await api.get(`/api/reports/${id}`);
  return data;
}

export async function deleteReport(id) {
  const { data } = await api.delete(`/api/reports/${id}`);
  return data;
}

export async function chatAi(payload) {
  const { data } = await api.post("/api/ai/chat", payload);
  return data;
}

export async function ragAi(payload) {
  const { data } = await api.post("/api/ai/rag", payload);
  return data;
}

export async function fetchProviderStatuses() {
  const { data } = await api.get("/api/ai/providers/status");
  return data;
}

export default api;
