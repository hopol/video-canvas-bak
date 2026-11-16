/**
 * 新建的生成节点用哪个模型：设置里记的默认模型还在服务端清单里就用它，
 * 不在（已下架）或没设置就不指定，节点自己会取清单第一个。
 * @param preferred 设置里这一种类的默认模型 key
 * @param models 服务端下发的这一种类的模型清单
 */
export function pickDefaultModel(
  preferred: string | undefined,
  models: readonly { key: string }[],
): string | undefined {
  return preferred && models.some((m) => m.key === preferred) ? preferred : undefined;
}
