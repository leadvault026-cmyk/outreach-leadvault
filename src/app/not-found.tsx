import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Wordmark tone="light" />
      <p className="text-muted-foreground mt-10 text-sm font-medium">404</p>
      <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    </main>
  );
}
