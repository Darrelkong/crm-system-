"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/form";
import { Card } from "@/components/ui/card";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
    };

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "註冊失敗");
      return;
    }

    router.push("/login");
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 px-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">建立帳號</h1>
          <p className="mt-2 text-sm text-slate-500">開始使用 CRM 系統</p>
        </div>

        <form onSubmit={handleSubmit}>
          <Field>
            <Label htmlFor="name">姓名</Label>
            <Input id="name" name="name" required placeholder="王小明" />
          </Field>
          <Field>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              placeholder="you@example.com"
            />
          </Field>
          <Field>
            <Label htmlFor="password">密碼</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              placeholder="至少 6 個字元"
            />
          </Field>

          {error && (
            <p className="mb-4 text-sm text-red-600">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "註冊中..." : "註冊"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          已有帳號？{" "}
          <Link href="/login" className="font-medium text-indigo-600">
            立即登入
          </Link>
        </p>
      </Card>
    </div>
  );
}
