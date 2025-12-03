"use client";

import { useEffect, useState } from "react";
import { Dino } from "../types";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type RouteParams = { params: Promise<{ dinosaur: string }> };

export default function Dinosaur({ params }: RouteParams) {
    const selectedDinosaur = params.then((params) => params.dinosaur);
    const [dinosaur, setDino] = useState<Dino>({ name: "", description: "" });

    useEffect(() => {
        (async () => {
            const resp = await fetch(`/api/dinosaurs/${await selectedDinosaur}`);
            const dino = await resp.json() as Dino;
            setDino(dino);
        })();
    }, []);

    return (
        <main className="flex min-h-screen flex-col items-center justify-center p-8">
            <div className="w-full max-w-2xl space-y-8">
                <div className="rounded-lg border border-border bg-card p-8 shadow-lg">
                    <h1 className="text-4xl font-bold tracking-tight text-foreground mb-4">
                        {dinosaur.name}
                    </h1>
                    <p className="text-muted-foreground text-lg leading-relaxed">
                        {dinosaur.description}
                    </p>
                </div>
                <Button asChild variant="outline" className="w-full">
                    <Link href="/">← Back to all dinosaurs</Link>
                </Button>
            </div>
        </main>
    );
}
