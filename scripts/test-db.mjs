import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import sharp from "sharp";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localConfig } from "./local-env.mjs";
const config = localConfig();
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const users = [];
let checks = 0;
function check(condition, label) {
  assert.ok(condition, label);
  checks++;
  console.log("PASS " + label);
}
async function makeUser() {
  const email = `test-${randomUUID()}@freezer.test`,
    password = randomUUID() + "aA1!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  users.push(data.user.id);
  const client = createClient(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
  return client;
}
const sql = new pg.Client({ connectionString: config.DB_URL });
await sql.connect();
try {
  const a = await makeUser(),
    b = await makeUser();
  const recipe = {
    name: "Testovací guláš",
    portions: 2,
    ingredients: [{ name: "Mäso", quantity: 700, unit: "g" }],
    steps: ["Dusiť."],
    reheating: "Dôkladne prehriať.",
  };
  const importId = randomUUID();
  let result = await a.rpc("import_recipes", {
    p_import_id: importId,
    p_recipes: [recipe],
  });
  check(!result.error, "recipe import");
  result = await a.rpc("import_recipes", {
    p_import_id: importId,
    p_recipes: [recipe],
  });
  check(!result.error, "idempotent import replay");
  const versions = await a.from("recipe_versions").select("*");
  check(versions.data?.length === 1, "one immutable recipe version");
  const foreign = await b.from("recipe_versions").select("*");
  check(foreign.data?.length === 0, "RLS isolates users");
  result = await b.rpc("create_batch", {
    p_version_id: versions.data[0].id,
    p_request_id: randomUUID(),
    p_weight_g: 1500,
    p_package_count: 2,
    p_cost_minor: 27801,
    p_best_before: "2027-01-01",
  });
  check(Boolean(result.error), "RPC rejects foreign recipe");
  const batchRequest = randomUUID();
  const batch = {
    p_version_id: versions.data[0].id,
    p_request_id: batchRequest,
    p_weight_g: 1500,
    p_package_count: 2,
    p_cost_minor: 27801,
    p_best_before: "2027-01-01",
  };
  result = await a.rpc("create_batch", batch);
  check(!result.error, "batch and inventory receipt");
  await a.rpc("create_batch", batch);
  const packages = await a.from("inventory_packages").select("*");
  check(packages.data?.length === 2, "idempotent batch");
  check(
    packages.data.reduce((sum, p) => sum + p.cost_minor, 0) === 27801,
    "cost allocation conserves minor units",
  );
  const first = packages.data[0];
  const direct = await a
    .from("inventory_packages")
    .update({ remaining_g: -1 })
    .eq("id", first.id);
  check(Boolean(direct.error), "direct stock mutation denied");
  const request = randomUUID();
  result = await a.rpc("consume_package", {
    p_package_id: first.id,
    p_request_id: request,
    p_grams: 250,
  });
  check(!result.error, "partial consumption");
  await a.rpc("consume_package", {
    p_package_id: first.id,
    p_request_id: request,
    p_grams: 250,
  });
  const after = await a
    .from("inventory_packages")
    .select("*")
    .eq("id", first.id)
    .single();
  check(
    after.data.remaining_g === 500,
    "duplicate consumption does not deduct twice",
  );
  result = await a.rpc("consume_package", {
    p_package_id: first.id,
    p_request_id: request,
    p_grams: 251,
  });
  check(Boolean(result.error), "request ID cannot change payload");
  const concurrent = await Promise.all([
    a.rpc("consume_package", {
      p_package_id: first.id,
      p_request_id: randomUUID(),
      p_grams: 400,
    }),
    a.rpc("consume_package", {
      p_package_id: first.id,
      p_request_id: randomUUID(),
      p_grams: 400,
    }),
  ]);
  check(
    concurrent.filter((r) => !r.error).length === 1,
    "concurrent stock deductions serialize",
  );
  const remainder = await a
    .from("inventory_packages")
    .select("*")
    .eq("id", first.id)
    .single();
  check(remainder.data.remaining_g === 100, "stock never becomes negative");
  result = await a.rpc("consume_package", {
    p_package_id: first.id,
    p_request_id: randomUUID(),
    p_grams: 100,
  });
  check(!result.error, "last partial consumption");
  const logs = await a.from("meal_logs").select("*").eq("package_id", first.id);
  check(
    logs.data.reduce((s, l) => s + l.cost_minor, 0) === first.cost_minor,
    "historical consumption costs conserve allocation",
  );
  const {
    data: { user },
  } = await a.auth.getUser();
  const location = await a
    .from("storage_locations")
    .insert({ user_id: user.id, name: "Zásuvka 2" })
    .select()
    .single();
  check(!location.error, "location creation");
  result = await a.rpc("move_package", {
    p_package_id: packages.data[1].id,
    p_request_id: randomUUID(),
    p_location_id: location.data.id,
  });
  check(!result.error, "audited package movement");
  const moved = await a
    .from("inventory_packages")
    .select("*")
    .eq("id", packages.data[1].id)
    .single();
  check(
    moved.data.location_id === location.data.id,
    "movement updates location",
  );
  result = await b.rpc("consume_package", {
    p_package_id: packages.data[1].id,
    p_request_id: randomUUID(),
    p_grams: 1,
  });
  check(Boolean(result.error), "cross-user consumption denied");
  result = await a.rpc("revise_recipe", {
    p_version_id: versions.data[0].id,
    p_request_id: randomUUID(),
    p_recipe: { ...recipe, name: "Nový názov" },
  });
  check(!result.error, "recipe revision");
  const history = await a
    .from("recipe_versions")
    .select("*")
    .eq("id", versions.data[0].id)
    .single();
  check(
    history.data.name === recipe.name,
    "historical recipe version unchanged",
  );
  result = await a.rpc("revise_recipe", {
    p_version_id: versions.data[0].id,
    p_request_id: randomUUID(),
    p_recipe: recipe,
  });
  check(Boolean(result.error), "stale recipe editing rejected");
  const latest = await a.from("recipe_latest").select("*");
  check(
    latest.data.length === 1 && latest.data[0].version === 2,
    "latest recipe view",
  );
  result = await a.rpc("archive_recipe", {
    p_recipe_id: versions.data[0].recipe_id,
    p_request_id: randomUUID(),
  });
  check(!result.error, "archive recipe");
  const archived = await a.from("recipe_latest").select("*");
  check(
    archived.data.length === 0,
    "archived recipe excluded from active list",
  );
  const originalBatch = await a.from("cooking_batches").select("*").single();
  check(
    originalBatch.data.cost_minor === 27801 &&
      originalBatch.data.recipe_version_id === versions.data[0].id,
    "historical batch keeps original cost and version",
  );
  const count = await sql.query(
    "select count(*)::int n from public.inventory_movements where user_id=$1",
    [user.id],
  );
  check(count.rows[0].n === 6, "ledger records only committed operations");
  const anon = createClient(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });
  result = await anon.rpc("import_recipes", {
    p_import_id: randomUUID(),
    p_recipes: [recipe],
  });
  check(Boolean(result.error), "anonymous RPC denied");
  // Photos are independent of versions; private storage and RPCs enforce ownership.
  const photoRoot = randomUUID();
  result = await a.rpc("create_recipe_with_id", {
    p_id: photoRoot,
    p_recipe: recipe,
  });
  check(!result.error, "create stable root for photos");
  result = await a.rpc("create_recipe_with_id", {
    p_id: photoRoot,
    p_recipe: recipe,
  });
  check(!result.error, "idempotent editor creation");
  const own = await a.auth.getUser();
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#a45232" },
  })
    .webp()
    .toBuffer();
  const photoIds = [randomUUID(), randomUUID()];
  const paths = [];
  for (const id of photoIds) {
    const base = `${own.data.user.id}/${photoRoot}/${id}/`;
    for (const suffix of ["large.webp", "thumb.webp"]) {
      const path = base + suffix;
      paths.push(path);
      const upload = await a.storage
        .from("recipe-photos")
        .upload(path, bytes, { contentType: "image/webp" });
      check(!upload.error, "private photo upload");
    }
    result = await a.rpc("add_recipe_photo", {
      p_recipe: photoRoot,
      p_id: id,
      p_alt: "Jedlo",
    });
    check(!result.error, "attach uploaded photo");
  }
  try {
    const photos = await a
      .from("recipe_photos")
      .select("*")
      .eq("recipe_id", photoRoot);
    check(photos.data.length === 2, "owner loads real photo records");
    check(
      (await b.from("recipe_photos").select("*").eq("recipe_id", photoRoot))
        .data.length === 0,
      "photo RLS isolates users",
    );
    check(
      Boolean(
        (await b.storage.from("recipe-photos").createSignedUrl(paths[0], 60))
          .error,
      ),
      "foreign signed URL denied",
    );
    check(
      Boolean(
        (await anon.storage.from("recipe-photos").createSignedUrl(paths[0], 60))
          .error,
      ),
      "anonymous private access denied",
    );
    const signed = await a.storage
      .from("recipe-photos")
      .createSignedUrl(paths[0], 60);
    check(
      !signed.error && (await fetch(signed.data.signedUrl)).ok,
      "owner signed photo is readable",
    );
    check(
      !(
        await fetch(
          config.API_URL +
            "/storage/v1/object/public/recipe-photos/" +
            paths[0],
        )
      ).ok,
      "bucket never public",
    );
    check(
      Boolean(
        (
          await b.rpc("add_recipe_photo", {
            p_recipe: photoRoot,
            p_id: randomUUID(),
            p_alt: "Foreign",
          })
        ).error,
      ),
      "foreign recipe attachment rejected",
    );
    check(
      Boolean(
        (
          await a.rpc("add_recipe_photo", {
            p_recipe: photoRoot,
            p_id: randomUUID(),
            p_alt: "Missing",
          })
        ).error,
      ),
      "missing image rejected",
    );
    result = await a.rpc("save_recipe_photos", {
      p_recipe: photoRoot,
      p_revision: 2,
      p_photos: [
        { id: photoIds[1], alt: "Hlavný záber" },
        { id: photoIds[0], alt: "Ďalší záber" },
      ],
    });
    check(!result.error, "atomic reorder and main photo");
    const main = await a
      .from("recipe_photos")
      .select("*")
      .eq("recipe_id", photoRoot)
      .order("position");
    check(
      main.data[0].id === photoIds[1] &&
        main.data[0].is_primary &&
        !main.data[1].is_primary,
      "exactly one selected cover",
    );
    check(
      Boolean(
        (
          await a.rpc("save_recipe_photos", {
            p_recipe: photoRoot,
            p_revision: 2,
            p_photos: [],
          })
        ).error,
      ),
      "stale photo update cannot delete newer data",
    );
    check(
      Boolean(
        (
          await a.rpc("save_recipe_photos", {
            p_recipe: photoRoot,
            p_revision: null,
            p_photos: [],
          })
        ).error,
      ),
      "missing concurrency revision rejected",
    );
    result = await a.rpc("save_recipe_photos", {
      p_recipe: photoRoot,
      p_revision: 3,
      p_photos: [{ id: photoIds[0], alt: "Zostávajúca fotografia" }],
    });
    check(!result.error, "photo removal promotes remaining cover");
    const foreignPath = paths[0].replace(photoIds[0], randomUUID());
    check(
      Boolean(
        (
          await b.storage
            .from("recipe-photos")
            .upload(foreignPath, bytes, { contentType: "image/webp" })
        ).error,
      ),
      "foreign storage upload denied",
    );
    check(
      Boolean(
        (
          await a
            .from("recipe_photos")
            .insert({
              id: randomUUID(),
              recipe_id: photoRoot,
              user_id: own.data.user.id,
              storage_path: foreignPath,
              thumbnail_path: foreignPath,
              position: 0,
              alt: "Direct",
              source_type: "own",
            })
        ).error,
      ),
      "direct photo mutation denied",
    );
    for (let i = 0; i < 7; i++) {
      const id = randomUUID(),
        base = `${own.data.user.id}/${photoRoot}/${id}/`;
      for (const suffix of ["large.webp", "thumb.webp"]) {
        const path = base + suffix;
        paths.push(path);
        const upload = await a.storage
          .from("recipe-photos")
          .upload(path, bytes, { contentType: "image/webp" });
        assert.ok(!upload.error);
      }
      const added = await a.rpc("add_recipe_photo", {
        p_recipe: photoRoot,
        p_id: id,
        p_alt: "Ďalší záber",
      });
      assert.ok(!added.error);
    }
    check(
      Boolean(
        (
          await a.rpc("add_recipe_photo", {
            p_recipe: photoRoot,
            p_id: randomUUID(),
            p_alt: "Deviata",
          })
        ).error,
      ),
      "database enforces eight-photo limit",
    );
    const unchanged = await a
      .from("recipe_versions")
      .select("*")
      .eq("recipe_id", photoRoot);
    check(
      unchanged.data.length === 1 &&
        unchanged.data[0].version === 1 &&
        unchanged.data[0].name === recipe.name,
      "photo edits preserve culinary versions",
    );
    const importedId = randomUUID();
    result = await a.rpc("import_recipes", {
      p_import_id: importedId,
      p_recipes: [
        {
          ...recipe,
          imageReferences: [
            {
              sourceUrl: "https://example.org/photo",
              author: "Autor",
              license: "CC BY 4.0",
              alt: "Ilustrácia",
            },
          ],
        },
      ],
    });
    check(!result.error, "optional image reference import");
    const pending = await a.from("recipe_image_references").select("*");
    check(
      pending.data.length === 1 && pending.data[0].status === "pending",
      "references kept pending without network fetching",
    );
    check(
      (await b.from("recipe_image_references").select("*")).data.length === 0,
      "reference RLS isolates users",
    );
  } finally {
    await a.storage.from("recipe-photos").remove(paths);
  }
  console.log(`${checks} database integration checks passed.`);
} finally {
  for (const id of users) {
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) throw result.error;
  }
  await sql.end();
}
