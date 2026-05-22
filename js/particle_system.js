/* WELDFORGE-X: High-Performance Spark & Embers Particle Physics System */

class SparkParticles {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.maxParticles = 120;
    this.pool = [];

    // Create shared geometry and materials to optimize memory
    this.geometry = new THREE.SphereGeometry(0.008, 6, 6);
    
    this.materials = {
      orange: new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true }),
      cyan: new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true }),
      magenta: new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true }),
      yellow: new THREE.MeshBasicMaterial({ color: 0xffea00, transparent: true })
    };

    // Pre-populate pool
    for (let i = 0; i < this.maxParticles; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.materials.orange.clone());
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({
        mesh: mesh,
        velocity: new THREE.Vector3(),
        lifespan: 0,
        age: 0,
        type: 'spatter'
      });
    }
  }

  spawn(position, colorName = 'orange', count = 4) {
    let spawned = 0;
    
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (p.mesh.visible) continue; // active

      p.mesh.position.copy(position);
      // Add slight offset randomized coordinates
      p.mesh.position.x += (Math.random() - 0.5) * 0.02;
      p.mesh.position.y += (Math.random() - 0.5) * 0.02;
      p.mesh.position.z += (Math.random() - 0.5) * 0.02;

      // Assign matching color material
      const targetMat = this.materials[colorName] || this.materials.orange;
      p.mesh.material.color.copy(targetMat.color);

      // Random 3D launch vector
      p.velocity.set(
        (Math.random() - 0.5) * 1.5,
        Math.random() * 1.8 + 0.3, // launching upward
        (Math.random() - 0.5) * 1.5
      );

      // Random lifespans: embers drift longer than spatters
      p.type = Math.random() < 0.25 ? 'ember' : 'spatter';
      p.lifespan = p.type === 'ember' ? Math.random() * 1.2 + 0.8 : Math.random() * 0.4 + 0.2;
      p.age = 0;
      
      p.mesh.visible = true;
      p.mesh.scale.set(1, 1, 1);

      spawned++;
      if (spawned >= count) break;
    }
  }

  update(dt) {
    const gravity = -4.5; // m/s2 deceleration
    
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.mesh.visible) continue;

      p.age += dt;
      if (p.age >= p.lifespan) {
        p.mesh.visible = false;
        continue;
      }

      // Physics Integration
      if (p.type === 'spatter') {
        p.velocity.y += gravity * dt; // Gravity pulls spatter down
      } else {
        // Embers drift slightly upward (hot thermal air currents)
        p.velocity.y += 0.25 * dt;
        p.velocity.x += Math.sin(p.age * 5.0) * 0.1 * dt; // Swaying motion
      }

      // Update positions
      p.mesh.position.addScaledVector(p.velocity, dt);

      // Fade out alpha opacity
      const opacity = 1.0 - (p.age / p.lifespan);
      p.mesh.material.opacity = opacity;
      
      // Shrink size
      const scale = opacity;
      p.mesh.scale.set(scale, scale, scale);

      // Bouncing floor vector check
      if (p.mesh.position.y <= 0.01 && p.velocity.y < 0) {
        p.mesh.position.y = 0.01;
        p.velocity.y = -p.velocity.y * 0.45; // elastical coefficient
        p.velocity.x *= 0.7; // friction
        p.velocity.z *= 0.7;
      }
    }
  }
}
