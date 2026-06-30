import { Card } from "@/components/ui";

export function ProfileCard({ username, role }: { username: string; role: string }) {
  const initial = username.charAt(0).toUpperCase();
  return (
    <Card>
      <div className="flex items-center gap-stack-md">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-container text-headline-md font-display font-bold text-on-primary-container">
          {initial}
        </div>
        <div className="flex flex-col gap-stack-sm">
          <p className="text-headline-md font-display">{username}</p>
          <span className="inline-flex w-fit items-center rounded-full bg-primary/10 px-3 py-1 text-label-md uppercase text-primary">
            {role === "PAYER" ? "Payer" : role}
          </span>
        </div>
      </div>
    </Card>
  );
}
