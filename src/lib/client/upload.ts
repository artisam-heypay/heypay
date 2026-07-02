export async function presignAndUpload(file: File, prefix: "qrph" | "logo"): Promise<string> {
  const res = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "presign",
      prefix,
      contentType: file.type,
      sizeBytes: file.size,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? "Could not prepare upload");
  }
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
