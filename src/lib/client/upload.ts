export async function presignAndUpload(file: File, prefix: "qrph" | "logo"): Promise<string> {
  const res = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefix, contentType: file.type, maxBytes: 5_000_000 }),
  });
  if (!res.ok) throw new Error("Could not prepare upload");
  const { url, fields, key } = (await res.json()) as {
    url: string;
    fields: Record<string, string>;
    key: string;
  };
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);
  const up = await fetch(url, { method: "POST", body: form });
  if (!up.ok) throw new Error("Upload failed");
  return key;
}
