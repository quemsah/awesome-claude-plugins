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
        <main>
            <h1>{dinosaur.name}</h1>
            <p>{dinosaur.description}</p>
            <Button asChild variant="secondary">
                <Link href="/">Back to all dinosaurs</Link>
            </Button>
        </main>
    );
}
