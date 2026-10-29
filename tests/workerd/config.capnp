using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "viggle-worker-smoke", worker = (
      modules = [(name = "bundle.mjs", esModule = embed "bundle.mjs")],
      compatibilityDate = "2026-10-29",
      compatibilityFlags = []
    ))
  ]
);
