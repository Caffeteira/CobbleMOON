package br.com.cobblemoon.store;

import com.google.gson.*;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class StoreBridge implements ModInitializer {
 private static final Logger LOG=LoggerFactory.getLogger("CobbleMOON-Store");
 private static final Gson GSON=new GsonBuilder().setPrettyPrinting().create();
 private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
 private final Path folder=FabricLoader.getInstance().getConfigDir().resolve("cobblemoon-store");
 private Config config;private ScheduledExecutorService scheduler;
 private static final class Config { boolean enabled=false;String siteUrl="https://cobblemoon.shop";String bridgeToken="";String serverId="moon-"+UUID.randomUUID();int pollSeconds=30; }
 private record Result(String status,String message) {}
 @Override public void onInitialize(){
  ServerLifecycleEvents.SERVER_STARTED.register(server->{try{Files.createDirectories(folder);Path file=folder.resolve("config.json");if(Files.exists(file))config=GSON.fromJson(Files.readString(file),Config.class);else{config=new Config();Files.writeString(file,GSON.toJson(config),StandardOpenOption.CREATE_NEW);}if(config==null||!config.enabled){LOG.info("Conector desativado. Configure config/cobblemoon-store/config.json e reinicie.");return;}URI uri=URI.create(config.siteUrl);if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||config.bridgeToken==null||config.bridgeToken.length()<32||config.serverId==null||!config.serverId.matches("[-a-zA-Z0-9_]{3,80}"))throw new IllegalArgumentException("Configuração do conector inválida");Files.createDirectories(folder.resolve("ledger"));scheduler=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"cobblemoon-store-http");t.setDaemon(true);return t;});scheduler.scheduleWithFixedDelay(()->poll(server),2,Math.max(15,config.pollSeconds),TimeUnit.SECONDS);LOG.info("Conector da loja ativado. Nenhuma porta de entrada é aberta.");}catch(Exception e){LOG.error("Conector não iniciado: {}",e.getClass().getSimpleName());}});
  ServerLifecycleEvents.SERVER_STOPPING.register(server->{if(scheduler!=null)scheduler.shutdownNow();});
 }
 private JsonObject post(String path,JsonObject data)throws Exception{
  URI uri=URI.create(config.siteUrl).resolve(path);
  HttpRequest req=HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(15)).header("Authorization","Bearer "+config.bridgeToken).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(data))).build();
  HttpResponse<String> res=http.send(req,HttpResponse.BodyHandlers.ofString());if(res.statusCode()!=200)throw new IllegalStateException("API HTTP "+res.statusCode());return JsonParser.parseString(res.body()).getAsJsonObject();
 }
 private void poll(MinecraftServer server){try{
  JsonArray players=server.submit(()->{JsonArray list=new JsonArray();for(ServerPlayerEntity p:server.getPlayerManager().getPlayerList()){JsonObject j=new JsonObject();j.addProperty("name",p.getGameProfile().getName());j.addProperty("uuid",p.getUuidAsString());list.add(j);}return list;}).get(15,TimeUnit.SECONDS);
  JsonObject data=new JsonObject();data.addProperty("serverId",config.serverId);data.add("players",players);
  JsonArray jobs=post("/api/bridge/poll",data).getAsJsonArray("jobs");
  for(JsonElement item:jobs){JsonObject job=item.getAsJsonObject();String id=job.get("id").getAsString();UUID.fromString(id);
   Result result=server.submit(()->execute(server,job)).get(15,TimeUnit.SECONDS);if(result==null)continue;
   JsonObject ack=new JsonObject();ack.addProperty("id",id);ack.addProperty("serverId",config.serverId);ack.addProperty("status",result.status());ack.addProperty("message",result.message());post("/api/bridge/ack",ack);
  }
 }catch(InterruptedException e){Thread.currentThread().interrupt();}catch(Exception e){LOG.warn("Loja sem confirmação neste ciclo ({}). Nova consulta no próximo ciclo; comandos concluídos não são repetidos.",e.getClass().getSimpleName());}}
 private Result execute(MinecraftServer server,JsonObject job){
  String id=job.get("id").getAsString();Path entry=folder.resolve("ledger").resolve(id+".json");
  try{
   if(Files.exists(entry)){JsonObject saved=JsonParser.parseString(Files.readString(entry)).getAsJsonObject();String status=saved.get("status").getAsString();return new Result(status.equals("done")?"done":"review",status.equals("done")?"Comando já concluído; confirmação reenviada.":"Execução anterior incerta ou falhou. Não repetida; confira manualmente.");}
   String name=job.get("player").getAsString(),uuid=job.get("uuid").getAsString(),command=job.get("command").getAsString();
   ServerPlayerEntity player=server.getPlayerManager().getPlayer(UUID.fromString(uuid));
   if(player==null||!player.getGameProfile().getName().equalsIgnoreCase(name))return null;
   if(!name.matches("[A-Za-z0-9_]{3,16}")||command.length()>500||command.contains("\n")||command.contains("\r")||command.indexOf(0)>=0)throw new IllegalArgumentException("Comando inválido");
   // Gravado e sincronizado ANTES do efeito no jogo. Após queda não executa novamente.
   persist(entry,"started");
   AtomicBoolean called=new AtomicBoolean(false),failed=new AtomicBoolean(false);
   var source=server.getCommandSource().withReturnValueConsumer((success,value)->{called.set(true);if(!success)failed.set(true);});
   server.getCommandManager().executeWithPrefix(source,command);
   String status=called.get()&&!failed.get()?"done":"review";
   persist(entry,status);LOG.info("Entrega {}: {}",id,status);
   return new Result(status,status.equals("done")?"Minecraft confirmou execução do comando.":"Comando sem sucesso confirmado; verifique o console e o item entregue antes de corrigir manualmente.");
  }catch(Exception e){LOG.error("Entrega {} necessita revisão ({})",id,e.getClass().getSimpleName());return new Result("review","Entrega interrompida ou inválida. Não repetida automaticamente.");}
 }
 private void persist(Path entry,String status)throws Exception{
  JsonObject record=new JsonObject();record.addProperty("status",status);record.addProperty("updatedAt",java.time.Instant.now().toString());
  byte[] bytes=GSON.toJson(record).getBytes(java.nio.charset.StandardCharsets.UTF_8);
  // Cada ID possui arquivo próprio. Escrita incompleta torna-se revisão, nunca nova execução.
  try(FileChannel file=FileChannel.open(entry,StandardOpenOption.CREATE,StandardOpenOption.WRITE,StandardOpenOption.TRUNCATE_EXISTING)){ByteBuffer data=ByteBuffer.wrap(bytes);while(data.hasRemaining())file.write(data);file.force(true);}
 }
}
