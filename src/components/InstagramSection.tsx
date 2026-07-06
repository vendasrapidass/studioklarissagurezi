import { motion } from 'framer-motion';

const InstagramSection = () => (
  <section className="py-24 px-4 md:px-6 max-w-5xl mx-auto">
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="glass p-6 md:p-8 rounded-3xl card-shadow space-y-6"
    >
      <h2 className="text-2xl md:text-3xl font-bold text-center">Siga no Instagram</h2>
      <img
        src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png"
        alt="Instagram STUDIO KLARISSA GUAREZI"
        className="w-24 h-24 mx-auto object-contain hover:scale-110 transition-transform duration-300"
        loading="lazy"
        width={150}
        height={150}
      />
      <a
        href="https://www.instagram.com/studio_klarissaguarezi/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full py-4 bg-gradient-to-tr from-purple-600 to-pink-500 rounded-xl font-bold text-foreground transition-all hover:opacity-90"
      >
        Seguir no Instagram
      </a>
    </motion.div>
  </section>
);

export default InstagramSection;
