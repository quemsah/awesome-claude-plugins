"use client";

import { useEffect, useState } from "react";
import { Dino } from "./types";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  const [dinosaurs, setDinosaurs] = useState<Dino[]>([]);

  useEffect(() => {
    (async () => {
      const response = await fetch(`/api/dinosaurs`);
      const allDinosaurs = await response.json() as Dino[];
      setDinosaurs(allDinosaurs);
    })();
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Welcome to the Dinosaur App
          </h1>
          <p className="text-muted-foreground">
            Click on a dinosaur below to learn more.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {dinosaurs.map((dinosaur: Dino) => (
            <Button
              key={dinosaur.name}
              asChild
              variant="outline"
              className="h-auto py-4 hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Link href={`/${dinosaur.name.toLowerCase()}`}>
                {dinosaur.name}
              </Link>
            </Button>
          ))}
        </div>
      </div>
    </main>
  );
}
