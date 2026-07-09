import Link from "next/link";
import { listUsers } from "@/server/admin/users";
import { StatBadge } from "@/components/admin/StatBadge";
import { UserActiveToggle } from "@/components/admin/UserActiveToggle";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const page = await listUsers({ q: sp.q, cursor: sp.cursor, limit: 20 });

  return (
    <section aria-labelledby="admin-users-heading">
      <h1
        id="admin-users-heading"
        className="font-display text-headline-lg-mobile text-on-surface lg:text-headline-lg"
      >
        Users
      </h1>

      <form className="mt-stack-lg flex gap-stack-sm" role="search" action="/admin/users">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search username"
          aria-label="Search users"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-2 text-body-md focus:ring-4 focus:ring-primary/10"
        />
        <button type="submit" className="rounded-lg bg-primary px-stack-lg py-2 text-on-primary">
          Search
        </button>
      </form>

      <div className="mt-stack-lg overflow-x-auto tonal-card rounded-lg">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Username</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Role</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Status</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Created</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Action</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((u) => (
              <tr key={u.id} className="border-t border-outline-variant">
                <td className="px-stack-md py-3 text-body-md text-on-surface">{u.username}</td>
                <td className="px-stack-md py-3 text-label-md uppercase text-on-surface-variant">
                  {u.role}
                </td>
                <td className="px-stack-md py-3">
                  {u.isActive ? (
                    <StatBadge tone="settled">Active</StatBadge>
                  ) : (
                    <StatBadge tone="error">Inactive</StatBadge>
                  )}
                </td>
                <td className="px-stack-md py-3 font-mono text-mono-data text-on-surface-variant">
                  {u.createdAt.toISOString().slice(0, 10)}
                </td>
                <td className="px-stack-md py-3">
                  <UserActiveToggle id={u.id} isActive={u.isActive} username={u.username} />
                </td>
              </tr>
            ))}
            {page.items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-stack-md py-stack-lg text-center text-body-md text-on-surface-variant"
                >
                  No users found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {page.nextCursor ? (
        <div className="mt-stack-lg flex justify-end">
          <Link
            href={`/admin/users?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), cursor: page.nextCursor }).toString()}`}
            className="rounded-lg border border-outline-variant px-stack-lg py-2 text-body-md text-primary hover:bg-surface-container-high"
          >
            Next page
          </Link>
        </div>
      ) : null}
    </section>
  );
}
