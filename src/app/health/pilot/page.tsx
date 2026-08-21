import Link from "next/link";

import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { getPilotDashboardReadModel } from "@/server/pilotTelemetry/readModel";

import { PilotDashboard } from "./pilot-dashboard";
import styles from "./pilot-dashboard.module.css";

export const dynamic = "force-dynamic";

export default async function PilotHealthPage() {
  const requestContext = await requireRequestCapability("billing.read");
  const model = await getPilotDashboardReadModel({
    organizationId: requestContext.organizationId,
    campusId: requestContext.campusId,
  });

  if (model.status === "UNAVAILABLE") {
    return (
      <main className={styles.page}>
        <p className={styles.eyebrow}>Pilot operations</p>
        <h1>Pilot evidence is unavailable</h1>
        <div className={`${styles.empty} ${styles.stop}`}>{model.message}</div>
        <p><Link href="/health">Return to system health</Link></p>
      </main>
    );
  }

  return <PilotDashboard model={model} />;
}
