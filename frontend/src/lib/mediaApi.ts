/** Media Studio API chaqiruvlari. */
import { API_URL, apiFetch } from "@/lib/api";

export type MediaItem = { id: string; kind: string; prompt: string; model: string; created_at: string };
export type ImageModel = { id: string; label: string };

export const getImageModels = () => apiFetch<ImageModel[]>("/media/models");
export const getMedia = () => apiFetch<MediaItem[]>("/media");
export const createImage = (prompt: string, model: string) =>
  apiFetch<MediaItem>("/media/images", { method: "POST", body: JSON.stringify({ prompt, model }) });
export const deleteMedia = (id: string) => apiFetch<void>(`/media/${id}`, { method: "DELETE" });
export const fileUrl = (id: string, download = false) => `${API_URL}/media/${id}/file${download ? "?download=1" : ""}`;
