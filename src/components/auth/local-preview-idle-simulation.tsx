import { Button } from "@/components/ui/button";

export function LocalPreviewIdleSimulation() {
  return (
    <form
      className="fixed bottom-4 left-4 z-50"
      method="post"
      action="/local-preview/auth/simulate-idle-expiry"
    >
      <Button
        type="submit"
        variant="secondary"
        className="border border-amber-300 bg-amber-50 text-amber-900 shadow-sm"
      >
        模拟 30 分钟无操作退出
      </Button>
    </form>
  );
}
