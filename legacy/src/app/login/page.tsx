"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/form";
import { Card } from "@/components/ui/card";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const result = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Email 或密碼錯誤");
      return;
    }

    window.location.href = "/";
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 px-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">登入 CRM</h1>
          <p className="mt-2 text-sm text-slate-500">管理你的客戶與銷售流程</p>
        </div>

        <form onSubmit={handleSubmit}>
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
              placeholder="••••••••"
            />
          </Field>

          {error && (
            <p className="mb-4 text-sm text-red-600">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "登入中..." : "登入"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          還沒有帳號？{" "}
          <Link href="/register" className="font-medium text-indigo-600">
            立即註冊
          </Link>
        </p>
      </Card>
    </div>
  );
}
