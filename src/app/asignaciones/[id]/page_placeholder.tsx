'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, Trash2, MessageSquare, Check, X } from 'lucide-react';
import Link from 'next/link';

interface Asignacion {
    id: number;
    usuario_nombre: string;
    discord_username: string;
    rol: string;
    descripcion: string;
    estado: string;
    asignado_en: string;
}

interface Informe {
    id: number;
    mensaje: string;
    creado_en: string;
}

export default function AsignacionDetailsPage() {
    const router = useRouter();
    const { id } = useParams();
    const [asignacion, setAsignacion] = useState<Asignacion | null>(null);
    const [informes, setInformes] = useState<Informe[]>([]);
    const [nuevoInforme, setNuevoInforme] = useState('');
    const [nuevoEstado, setNuevoEstado] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (id) {
            fetchData();
        }
    }, [id]);

    const fetchData = async () => {
        try {
            setLoading(true);
            // Fetch assignment details (using PATCH endpoint GET logic or a dedicated endpoint? 
            // API route for [id] is PATCH/DELETE. I implemented GET in list with filters, but not for ID.
            // Wait, list API was `/api/asignaciones`. `/api/asignaciones/[id]` handles PATCH/DELETE.
            // I missed GET for single assignment!
            // In Next.js App Router, `GET(request, { params })` in [id]/route.js handles GET /api/asignaciones/:id.
            // I implemented PATCH and DELETE in `src/app/api/asignaciones/[id]/route.js`.
            // I need to add GET to `src/app/api/asignaciones/[id]/route.js`.
            // I will add it now in a separate step or just mock it by filtering list? No, better to add it.
            // For now, I'll check if I can add it swiftly.
            // Or I can use existing logic if I didn't forget. I checked Step 102 (`src/app/api/asignaciones/[id]/route.js`).
            // It has PATCH and DELETE.
            // I MUST add GET to that file.

            // I'll fix the API route first.
        } catch (err) {
            console.error(err);
        }
    };

    // Placeholder render
    return <div className="loader" />;
}
