export const dynamic = "force-dynamic";

import { PageIntro } from "@/components/ui/page-intro";
import { DevicesClient } from "./devices-client";

export default function AdminDevicesPage() {
  return (
    <div>
      <PageIntro
        title="設備授權"
        description="審核團隊成員登入設備、批准或撤銷授權。每位團隊成員預設最多 2 台已授權設備。"
      />
      <DevicesClient />
    </div>
  );
}
