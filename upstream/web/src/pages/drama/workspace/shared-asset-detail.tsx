import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AssetItem } from "@/utils/drama/assets";

function Media({ src, kind, label }: { src: string; kind?: string; label: string }) {
  if (kind === "video")
    return (
      <video
        aria-label={label}
        src={src}
        controls
        preload="metadata"
        className="max-h-80 w-full rounded-lg"
      />
    );
  if (kind === "audio")
    return <audio aria-label={label} src={src} controls preload="metadata" className="w-full" />;
  return (
    <img
      alt={label}
      src={src}
      loading="lazy"
      className="max-h-80 w-full rounded-lg object-contain"
    />
  );
}

export function SharedAssetDetail({ item }: { item: AssetItem }) {
  const { data } = item;
  const character = data.character;
  const media = new Map<string, { kind?: string; label: string }>();
  if (data.src) media.set(data.src, { kind: data.mediaType ?? item.type, label: item.name });
  for (const [index, output] of (data.outputs ?? []).entries())
    if (output.src)
      media.set(output.src, {
        kind: output.mediaType,
        label: `版本 ${index + 1}${output.id === data.activeOutputId ? " · 已选用" : ""}`,
      });
  for (const [index, extra] of (character?.extras ?? []).entries())
    if (extra.src) media.set(extra.src, { kind: "image", label: `补充图 ${index + 1}` });
  if (character?.voice?.src)
    media.set(character.voice.src, { kind: "audio", label: character.voice.name || "角色音色" });
  for (const asset of Object.values(data.paramAssets ?? {}))
    if (asset.url)
      media.set(asset.url, { kind: asset.mediaType, label: asset.fileName || "参考素材" });
  const prompt = String(data.params?.prompt ?? data.prompt ?? "");
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-xs" aria-label={`查看 ${item.name} 的详情`} />}
      >
        <Eye />
      </DialogTrigger>
      <DialogContent className="flex max-h-[85svh] flex-col">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-auto whitespace-pre-wrap text-sm">
          {[
            character?.description ?? data.drama?.description,
            data.text,
            prompt,
            character?.voicePrompt,
          ]
            .filter(Boolean)
            .map((text, index) => (
              <p key={index}>{String(text)}</p>
            ))}
          {[...media].map(([src, meta]) => (
            <figure key={src}>
              <figcaption className="text-muted-foreground mb-1 text-xs">{meta.label}</figcaption>
              <Media src={src} {...meta} />
            </figure>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
