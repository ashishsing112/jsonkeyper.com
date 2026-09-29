import com.fasterxml.jackson.databind.*;
import java.nio.file.*;
import java.util.List;

/** Deserialises each case in ../cases.json into a record with Jackson 2's default ObjectMapper. */
public class Check {
    public record Order(long id, String name, String note, List<String> tags) {}

    public static void main(String[] args) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        if (args.length > 0 && args[0].equals("strict")) {
            mapper.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES,
                          DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
                          DeserializationFeature.FAIL_ON_NULL_CREATOR_PROPERTIES);
        }
        JsonNode cases = mapper.readTree(Files.readString(Path.of("../cases.json")));
        for (JsonNode c : cases) {
            String result;
            try {
                result = "OK " + mapper.treeToValue(c.get(1), Order.class);
            } catch (Exception e) {
                result = "ERROR " + e.getClass().getSimpleName();
            }
            System.out.println(c.get(0).asText() + "\t" + result);
        }
    }
}
