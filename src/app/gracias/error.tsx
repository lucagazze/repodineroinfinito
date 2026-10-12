"use client";

import RetryScreen from "@/components/RetryScreen";

/** Si la página falla al armarse: reintento y salida, nunca un 500 en blanco. */
export default function Error({ error }: { error: Error & { digest?: string } }) {
  return <RetryScreen kind="gracias" error={error} />;
}
