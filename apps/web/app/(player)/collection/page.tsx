import type { Metadata } from "next";
import { Collection } from "@/components/collection/collection";

export const metadata: Metadata = { title: "Collection" };

export default function CollectionPage() {
  return <Collection />;
}
