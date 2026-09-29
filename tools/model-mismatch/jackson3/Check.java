import tools.jackson.databind.*;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.util.List;

/** Deserialises each case in ../cases.json into a record with Jackson 3's default JsonMapper. */
public class Check {
    public record Order(long id, String name, String note, List<String> tags) {}

    public static void main(String[] args) throws Exception {
        JsonMapper.Builder builder = JsonMapper.builder();
        if (args.length > 0 && args[0].equals("strict")) {
            builder.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES,
                           DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
                           DeserializationFeature.FAIL_ON_NULL_CREATOR_PROPERTIES);
        }
        ObjectMapper mapper = builder.build();
        JsonNode cases = mapper.readTree(Files.readString(Path.of("../cases.json")));
        for (JsonNode c : cases) {
            String result;
            try {
                result = "OK " + mapper.treeToValue(c.get(1), Order.class);
            } catch (Exception e) {
                result = "ERROR " + e.getClass().getSimpleName();
            }
            System.out.println(c.get(0).asString() + "\t" + result);
        }
    }
}
