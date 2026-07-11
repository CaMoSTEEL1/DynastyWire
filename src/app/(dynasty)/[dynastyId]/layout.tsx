// Thin server layout for static export. The single local dynasty uses the fixed id
// "current"; all data loading + chrome live in the client DynastyShell.
import DynastyShell from "@/components/dynasty/dynasty-shell";

export function generateStaticParams() {
  return [{ dynastyId: "current" }];
}

export default function DynastyLayout({ children }: { children: React.ReactNode }) {
  return <DynastyShell>{children}</DynastyShell>;
}
