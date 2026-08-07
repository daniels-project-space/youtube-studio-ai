"""
trailer.py — "THE ANTWERP HEIST" cinematic trailer, all custom assets in Blender 4.0 EEVEE.
Usage:  blender -b -noaudio -t 6 -P trailer.py -- <shot> <outdir> [preview]
  <shot>   one of: city vault grid steel breach gem title
  <outdir> where PNG frames (or preview.png) are written
  preview  if present, render only the middle frame to <outdir>/prev_<shot>.png
Headless EEVEE + AgX + Bloom. Deterministic.  (rev2: door faces camera, exposure fixes)
"""
import bpy, sys, math, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SHOT = argv[0] if argv else "vault"
OUT  = argv[1] if len(argv) > 1 else "/tmp/trailer"
PREVIEW = len(argv) > 2 and argv[2] == "preview"
FPS = 24
RES = (1280, 720)
SAMPLES = 20   # full render: bloom + grade + fast cuts + grain hide it

# ---------------------------------------------------------------- helpers
def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for b in list(blk):
            if b.users == 0:
                blk.remove(b)

def setup(samples=SAMPLES, frames=120, world_rgb=(0.01, 0.012, 0.02), world_str=0.25):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    ev = sc.eevee
    ev.taa_render_samples = samples
    ev.use_bloom = True
    ev.bloom_intensity = 0.045; ev.bloom_threshold = 1.1; ev.bloom_radius = 6.5; ev.bloom_knee = 0.4
    ev.use_gtao = True; ev.gtao_distance = 0.6
    ev.use_ssr = True; ev.use_ssr_refraction = True
    ev.use_soft_shadows = True; ev.taa_samples = 8
    ev.use_motion_blur = False   # ~2x faster; slow camera moves don't need it (and ffmpeg grade adds polish)
    ev.use_volumetric_lights = True
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.fps = FPS
    sc.render.image_settings.file_format = "PNG"
    sc.frame_start = 1; sc.frame_end = frames
    w = bpy.data.worlds.new("W"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*world_rgb, 1.0)
    bg.inputs[1].default_value = world_str
    return sc

def metal(name, color, rough=0.25, metallic=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    return m

def emit(name, color, strength=8.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs[0].default_value = (*color, 1.0); e.inputs[1].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs[0])
    return m

def glass(name, color=(0.9, 0.95, 1.0)):
    m = bpy.data.materials.new(name); m.use_nodes = True
    m.use_screen_refraction = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Transmission Weight"].default_value = 1.0   # Blender 4.0 renamed "Transmission"
    b.inputs["Roughness"].default_value = 0.02
    b.inputs["IOR"].default_value = 2.42
    return m

def light(kind, loc, energy, color=(1, 1, 1), size=2.0, rot=(0, 0, 0)):
    bpy.ops.object.light_add(type=kind, location=loc, rotation=rot)
    L = bpy.context.object
    L.data.energy = energy; L.data.color = color
    if kind == "AREA": L.data.size = size
    if kind == "SPOT": L.data.spot_size = size
    return L

def cam(loc, look, lens=42):
    tgt = bpy.data.objects.new("tgt", None); bpy.context.collection.objects.link(tgt)
    tgt.location = look
    bpy.ops.object.camera_add(location=loc)
    c = bpy.context.object; c.data.lens = lens
    con = c.constraints.new("TRACK_TO"); con.target = tgt
    con.track_axis = "TRACK_NEGATIVE_Z"; con.up_axis = "UP_Y"
    bpy.context.scene.camera = c
    return c, tgt

def key(obj, frame, **props):
    for path, val in props.items():
        setattr(obj, path, val)
        obj.keyframe_insert(data_path=path, frame=frame)

def ease(obj):
    if obj.animation_data and obj.animation_data.action:
        for fc in obj.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"; kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"

def fog(loc=(0, 0, 1), size=30, density=0.012):
    bpy.ops.mesh.primitive_cube_add(size=size, location=loc)
    d = bpy.context.object; d.name = "fog"
    m = bpy.data.materials.new("fogm"); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    v = nt.nodes.new("ShaderNodeVolumePrincipled")
    v.inputs["Density"].default_value = density
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(v.outputs[0], o.inputs["Volume"])
    d.data.materials.append(m)
    return d

# ---------------------------------------------------------------- the vault door (faces -Y / camera)
def vault_door(y=0):
    steel = metal("steel", (0.34, 0.35, 0.37), rough=0.30)
    gold  = metal("gold",  (0.85, 0.62, 0.20), rough=0.20)
    # door disc: cylinder axis rotated to Y, so its round face points at -Y (the camera)
    bpy.ops.mesh.primitive_cylinder_add(vertices=72, radius=3.0, depth=0.7, location=(0, y + 0.35, 0), rotation=(math.pi / 2, 0, 0))
    door = bpy.context.object; door.data.materials.append(steel)
    bpy.ops.mesh.primitive_torus_add(major_radius=3.05, minor_radius=0.16, location=(0, y, 0), rotation=(math.pi / 2, 0, 0))
    bpy.context.object.data.materials.append(gold)
    for k in range(30):  # bolt ring on the face plane (XZ)
        a = k / 30 * 2 * math.pi
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.11, depth=0.5, location=(2.55 * math.cos(a), y, 2.55 * math.sin(a)), rotation=(math.pi / 2, 0, 0))
        bpy.context.object.data.materials.append(gold)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.8, depth=0.9, location=(0, y - 0.1, 0), rotation=(math.pi / 2, 0, 0))
    hub = bpy.context.object; hub.data.materials.append(gold); hub.name = "hub"
    for rot in [(0, math.pi / 2, 0), (0, 0, 0)]:  # cross spokes in the face plane
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.09, depth=2.4, location=(0, y - 0.15, 0), rotation=rot)
        sp = bpy.context.object; sp.data.materials.append(gold); sp.parent = hub
    return door, hub

# ---------------------------------------------------------------- shots
def s_city(F=168):
    setup(frames=F, world_rgb=(0.03, 0.05, 0.10), world_str=0.40)
    body = metal("city", (0.05, 0.055, 0.07), rough=0.45, metallic=0.6)
    win = emit("win", (1.0, 0.82, 0.5), 5.0); win2 = emit("win2", (0.55, 0.75, 1.0), 4.0)
    n = 11
    for i in range(n):
        for j in range(n):
            h = 1.5 + ((i * 7 + j * 13) % 13) * 1.1
            x = (i - n / 2) * 2.0; y = (j - n / 2) * 2.0
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, h / 2))
            b = bpy.context.object; b.scale = (0.7, 0.7, h); b.data.materials.append(body)
            for w in range(int(h)):  # window strips up each face
                if (i * 5 + j * 3 + w) % 2 == 0:
                    bpy.ops.mesh.primitive_cube_add(size=0.13, location=(x + 0.36, y - 0.1, 0.5 + w * 0.9))
                    bpy.context.object.data.materials.append(win if (i + j) % 3 else win2)
    light("AREA", (12, -14, 20), 900, (0.7, 0.8, 1.0), size=18)   # moon key
    light("AREA", (-16, 10, 8), 320, (1.0, 0.6, 0.35), size=12)   # warm bounce
    fog(size=70, density=0.004)
    c, t = cam((18, -22, 11), (0, 0, 3), lens=32)
    key(c, 1, location=(18, -22, 11)); key(c, F, location=(10, -14, 8)); ease(c)
    key(t, 1, location=(0, 0, 4)); key(t, F, location=(0, 0, 2.5)); ease(t)

def s_vault(F=192):
    setup(frames=F)
    vault_door()
    light("AREA", (5, -6, 4), 700, (1.0, 0.95, 0.85), size=4)
    light("AREA", (-6, -4, 2), 300, (0.4, 0.55, 1.0), size=6)   # cold rim
    light("AREA", (0, -7, -3), 320, (1.0, 0.8, 0.5), size=5)    # warm low fill
    c, t = cam((0, -11, 0.4), (0, 0, 0), lens=44)
    key(c, 1, location=(0.6, -12, 1.2)); key(c, F, location=(0, -7.2, 0)); ease(c)

def s_grid(F=192):
    setup(frames=F, world_rgb=(0.01, 0.01, 0.015), world_str=0.05)
    wall = metal("wall", (0.04, 0.04, 0.05), rough=0.6, metallic=0.3)
    for (loc, scl) in [((0, 0, -1.5), (3, 16, 0.1)), ((0, 0, 3), (3, 16, 0.1)),
                       ((-3, 0, 0.75), (0.1, 16, 2.5)), ((3, 0, 0.75), (0.1, 16, 2.5))]:
        bpy.ops.mesh.primitive_cube_add(size=2, location=loc); o = bpy.context.object
        o.scale = scl; o.data.materials.append(wall)
    red = emit("red", (1.0, 0.05, 0.05), 14.0)
    for i in range(11):
        y = -7 + i * 1.4
        ang = (i % 2) * math.pi / 2 + (i % 3) * 0.5
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.015, depth=5.2,
            location=(0, y, 0.75), rotation=(0, math.pi / 2, ang))
        bpy.context.object.data.materials.append(red)
    fog(loc=(0, 0, 0.75), size=18, density=0.03)
    c, t = cam((0, -8.5, 0.9), (0, 0, 0.75), lens=30)
    key(c, 1, location=(0, -8.5, 0.9)); key(c, F, location=(0, 3.5, 0.7)); ease(c)
    key(t, 1, location=(0, -2, 0.8)); key(t, F, location=(0, 9, 0.8)); ease(t)

def s_steel(F=192):
    setup(frames=F, world_str=0.15)
    steel = metal("st", (0.20, 0.21, 0.23), rough=0.40)
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0)); slab = bpy.context.object
    slab.scale = (3.2, 0.4, 4.2); slab.data.materials.append(steel)
    bolt = metal("bolt", (0.42, 0.43, 0.45), rough=0.28)
    for i in range(5):
        for j in range(7):
            bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.13, depth=0.3,
                location=(-2.4 + i * 1.2, -0.85, -3.4 + j * 1.15), rotation=(math.pi / 2, 0, 0))
            bpy.context.object.data.materials.append(bolt)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1, location=(2.0, -0.95, 2.6))
    bpy.context.object.data.materials.append(emit("sensor", (1.0, 0.05, 0.05), 9.0))
    light("AREA", (5, -7, 4), 620, (1.0, 0.9, 0.8), size=6)
    light("AREA", (-6, -6, -2), 280, (0.45, 0.55, 1.0), size=6)
    light("AREA", (3, -5, 2), 220, (1.0, 0.85, 0.7), size=4)   # face fill so the steel reads
    c, t = cam((0.5, -8, -2.5), (0, 0, 1.2), lens=40)
    key(c, 1, location=(0.6, -8, -2.6)); key(c, F, location=(-0.3, -7, 2.0)); ease(c)
    key(t, 1, location=(0, 0, -1)); key(t, F, location=(0, 0, 2.2)); ease(t)

def s_breach(F=216):
    setup(frames=F, world_rgb=(0.015, 0.01, 0.008), world_str=0.10)
    door, hub = vault_door()
    key(hub, 1, rotation_euler=(0, 0, 0)); key(hub, F, rotation_euler=(0, math.radians(160), 0)); ease(hub)
    bpy.ops.mesh.primitive_plane_add(size=1.5, location=(0, -0.25, 0), rotation=(math.pi / 2, 0, 0))
    g = bpy.context.object; g.scale = (1.3, 1, 1); g.data.materials.append(emit("glow", (1.0, 0.72, 0.4), 5.0))
    light("AREA", (4, -7, 4), 600, (1.0, 0.85, 0.7), size=4)
    light("AREA", (-5, -5, 1), 250, (0.4, 0.55, 1.0), size=6)
    c, t = cam((3, -10, 1.2), (0, 0, 0), lens=46)
    key(c, 1, location=(3.2, -10, 1.4)); key(c, F, location=(-2.2, -8.5, 0.6)); ease(c)

def s_gem(F=168):
    setup(frames=F, world_rgb=(0.04, 0.05, 0.08), world_str=0.5)
    ped = metal("ped", (0.06, 0.06, 0.07), rough=0.35, metallic=0.6)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=1.0, depth=1.6, location=(0, 0, -0.85))
    bpy.context.object.data.materials.append(ped)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.7, location=(0, 0, 0.45))
    gem = bpy.context.object
    for p in gem.data.polygons: p.use_smooth = False
    gm = glass("gem", (0.85, 0.92, 1.0))
    gm.node_tree.nodes["Principled BSDF"].inputs["Transmission Weight"].default_value = 0.82  # leave some reflection -> sparkle
    gem.data.materials.append(gm); gem.name = "gem"
    key(gem, 1, rotation_euler=(0, 0, 0)); key(gem, F, rotation_euler=(0, 0, math.radians(120))); ease(gem)
    light("SPOT", (0, -1.5, 6), 4500, (1.0, 0.97, 0.9), size=0.8, rot=(0.3, 0, 0))
    light("AREA", (-4, -3, 3), 500, (0.5, 0.7, 1.0), size=4)
    light("AREA", (4, -2, 1), 400, (1.0, 0.85, 0.6), size=4)
    for lx in (-6, 6):  # bright side cards, OUT of the narrow lens, just to spark the facets
        bpy.ops.mesh.primitive_plane_add(size=5, location=(lx, 1, 2), rotation=(math.pi / 2, 0, (0.4 if lx > 0 else -0.4)))
        bpy.context.object.data.materials.append(emit("card%d" % lx, (0.8, 0.88, 1.0), 2.2))
    c, t = cam((2.6, -4.5, 1.1), (0, 0, 0.4), lens=56)
    key(c, 1, location=(2.8, -4.5, 1.2)); key(c, F, location=(-2.6, -4, 0.9)); ease(c)

def s_title(F=240):
    setup(frames=F, world_rgb=(0.01, 0.01, 0.012), world_str=0.08)
    def text3d(body, loc, size):
        cu = bpy.data.curves.new(body, "FONT"); cu.body = body
        cu.extrude = 0.05; cu.bevel_depth = 0.010; cu.size = size; cu.align_x = "CENTER"
        ob = bpy.data.objects.new(body, cu); bpy.context.collection.objects.link(ob)
        ob.location = loc; ob.rotation_euler = (math.pi / 2, 0, 0)
        ob.data.materials.append(metal("tt", (0.80, 0.62, 0.26), rough=0.24))
        return ob
    text3d("THE ANTWERP", (0, 0, 0.85), 0.82)
    text3d("HEIST", (0, 0, -0.95), 1.5)
    light("AREA", (4, -7, 4), 700, (1.0, 0.9, 0.75), size=6)
    light("AREA", (-5, -7, -1), 350, (0.45, 0.55, 1.0), size=6)
    c, t = cam((0, -15, 0), (0, 0, 0), lens=50)
    key(c, 1, location=(0, -16.5, 0.2)); key(c, F, location=(0, -13.5, 0)); ease(c)

SHOTS = {"city": s_city, "vault": s_vault, "grid": s_grid, "steel": s_steel,
         "breach": s_breach, "gem": s_gem, "title": s_title}

# ---------------------------------------------------------------- run
clear()
SHOTS[SHOT]()
sc = bpy.context.scene
os.makedirs(OUT, exist_ok=True)
if PREVIEW:
    sc.frame_set((sc.frame_start + sc.frame_end) // 2)
    sc.render.filepath = os.path.join(OUT, "prev_%s.png" % SHOT)
    bpy.ops.render.render(write_still=True)
else:
    sc.render.filepath = os.path.join(OUT, SHOT + "_")
    bpy.ops.render.render(animation=True)
print("DONE", SHOT)
