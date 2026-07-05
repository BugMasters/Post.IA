import { requireUser } from "@/infra/auth/require-user";
import { listPosts } from "@/features/posts/posts.repository";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GenerateVariant } from "@/infra/llm/types";

export default async function PostsPage() {
  const user = await requireUser();
  const posts = await listPosts(user.id);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="font-display text-3xl italic font-medium tracking-tight">Histórico</h1>
      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Você ainda não gerou posts.</p>
      ) : (
        posts.map((post) => (
          <Card key={post.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {post.theme} · {post.platform} · {post.createdAt.toLocaleDateString("pt-BR")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(post.variants as GenerateVariant[]).map((v) => (
                <div key={v.label}>
                  <p className="font-semibold">{v.label}</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{v.content}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </main>
  );
}
