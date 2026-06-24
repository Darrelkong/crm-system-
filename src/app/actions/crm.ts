"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/utils";

export async function createCompany(formData: FormData) {
  const user = await getSessionUser();
  await prisma.company.create({
    data: {
      name: formData.get("name") as string,
      industry: (formData.get("industry") as string) || null,
      website: (formData.get("website") as string) || null,
      phone: (formData.get("phone") as string) || null,
      address: (formData.get("address") as string) || null,
      userId: user.id,
    },
  });
  revalidatePath("/companies");
  revalidatePath("/");
}

export async function deleteCompany(id: string) {
  const user = await getSessionUser();
  await prisma.company.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/companies");
  revalidatePath("/");
}

export async function createContact(formData: FormData) {
  const user = await getSessionUser();
  const companyId = formData.get("companyId") as string;
  await prisma.contact.create({
    data: {
      firstName: formData.get("firstName") as string,
      lastName: formData.get("lastName") as string,
      email: (formData.get("email") as string) || null,
      phone: (formData.get("phone") as string) || null,
      title: (formData.get("title") as string) || null,
      companyId: companyId || null,
      userId: user.id,
    },
  });
  revalidatePath("/contacts");
  revalidatePath("/");
}

export async function deleteContact(id: string) {
  const user = await getSessionUser();
  await prisma.contact.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/contacts");
  revalidatePath("/");
}

export async function createTask(formData: FormData) {
  const user = await getSessionUser();
  const dueDate = formData.get("dueDate") as string;
  const contactId = formData.get("contactId") as string;
  const companyId = formData.get("companyId") as string;

  await prisma.task.create({
    data: {
      title: formData.get("title") as string,
      description: (formData.get("description") as string) || null,
      status: (formData.get("status") as string) || "todo",
      priority: (formData.get("priority") as string) || "medium",
      dueDate: dueDate ? new Date(dueDate) : null,
      contactId: contactId || null,
      companyId: companyId || null,
      userId: user.id,
    },
  });
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function updateTaskStatus(id: string, status: string) {
  const user = await getSessionUser();
  await prisma.task.updateMany({
    where: { id, userId: user.id },
    data: { status },
  });
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function deleteTask(id: string) {
  const user = await getSessionUser();
  await prisma.task.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function createNote(formData: FormData) {
  const user = await getSessionUser();
  const contactId = formData.get("contactId") as string;
  const companyId = formData.get("companyId") as string;

  await prisma.note.create({
    data: {
      content: formData.get("content") as string,
      contactId: contactId || null,
      companyId: companyId || null,
      userId: user.id,
    },
  });
  revalidatePath("/notes");
  revalidatePath("/");
}

export async function deleteNote(id: string) {
  const user = await getSessionUser();
  await prisma.note.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/notes");
  revalidatePath("/");
}
