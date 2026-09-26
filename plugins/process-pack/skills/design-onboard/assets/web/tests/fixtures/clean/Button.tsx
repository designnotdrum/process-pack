export function Button({ children }: { children: React.ReactNode }) {
  return (
    <button className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2">
      <a href="#add">{children}</a>
    </button>
  );
}
