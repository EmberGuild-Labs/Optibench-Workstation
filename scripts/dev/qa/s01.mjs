export default async (api) => {
  const errs = await api.collect();
  await api.click(437, 355);
  await api.sleep(800);
  await api.shot(process.env.S + '/s2.png');
  return errs;
};
