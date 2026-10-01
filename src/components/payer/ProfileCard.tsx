import { Card } from "@/components/ui";

export function ProfileCard({ username, role }: { username: string; role: string }) {
  const initial = username.charAt(0).toUpperCase();
  return (
    <Card className="flex items-center gap-stack-md">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-container font-display text-headline-md font-bold text-on-primary-container"
      >
        {initial}
      </span>
      <div>
        <p className="font-display text-headline-md">{username}</p>
        <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-label-md uppercase text-primary">
          {role === "PAYER" ? "Payer" : role}
        </span>
      </div>
    </Card>
  );
}
