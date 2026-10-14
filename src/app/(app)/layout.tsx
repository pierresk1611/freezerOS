import { configured, db } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { Home, Snowflake, BookOpen, Dices, LogOut } from "lucide-react";
import { logout } from "../login/actions";
const links = [
  { href: "/", label: "Domov", icon: Home },
  { href: "/inventory", label: "Mraznička", icon: Snowflake },
  { href: "/recipes", label: "Recepty", icon: BookOpen },
  { href: "/surprise", label: "Prekvap ma!", icon: Dices },
];
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!configured()) redirect("/login");
  const client = await db();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">❄ FREEZER OS</div>
        <nav>
          {links.map((x) => (
            <a href={x.href} key={x.href}>
              <x.icon size={20} />
              {x.label}
            </a>
          ))}
        </nav>
        <form action={logout} style={{ marginTop: 40 }}>
          <button>
            <LogOut size={16} />
            Odhlásiť sa
          </button>
        </form>
      </aside>
      <main>
        <div className="topline">Vaša každodenná kuchyňa · CZK</div>
        {children}
      </main>
      <nav className="bottom" aria-label="Hlavná navigácia">
        {links.map((x) => (
          <a href={x.href} key={x.href}>
            <x.icon size={22} />
            {x.label}
          </a>
        ))}
        <form action={logout}>
          <button aria-label="Odhlásiť sa">
            <LogOut size={18} />
          </button>
        </form>
      </nav>
    </div>
  );
}
